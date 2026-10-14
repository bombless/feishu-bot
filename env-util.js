'use strict'

const { spawnSync } = require('node:child_process')

const SERVICE = 'feishu-bot'
const KEYS = [
  'URL', 'KEY', 'MODEL', 'MODELS_URL', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET',
  'CODEX_BIN', 'AGENT_PORT', 'AGENT_HOST'
]

function vaultCommand (args, input) {
  // On Windows, npm-installed CLIs are commonly exposed as vault.cmd; shell is
  // required there. Arguments used here are fixed commands and validated keys.
  const result = spawnSync('vault', args, {
    encoding: 'utf8',
    input,
    windowsHide: true,
    shell: process.platform === 'win32',
    maxBuffer: 1024 * 1024
  })
  if (result.error) {
    throw new Error(`无法执行 vault 命令。请先安装 vault CLI 并确保它位于 PATH 中：${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(detail || `vault 命令执行失败，退出码 ${result.status}`)
  }
  return (result.stdout || '').replace(/\r?\n$/, '')
}

async function getStoredValue (key) {
  if (!KEYS.includes(key)) throw new Error(`不允许读取未知配置项：${key}`)
  try {
    return vaultCommand(['read', key])
  } catch (error) {
    // Missing keys are a normal case; distinguish that from a missing profile
    // or a broken vault installation so startup errors remain actionable.
    if (/键不存在/.test(error.message)) return null
    throw error
  }
}

async function saveEnv () {
  const updates = Object.fromEntries(KEYS
    .filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]]))

  if (Object.keys(updates).length === 0) {
    throw new Error(`没有发现可保存的环境变量。请先设置以下变量之一：${KEYS.join(', ')}`)
  }

  // Send values over stdin rather than command-line arguments, avoiding shell
  // history and process-list exposure of the actual secret values.
  for (const [key, value] of Object.entries(updates)) {
    vaultCommand(['write', key, '--stdin'], value)
    console.log(`已保存 ${key} 到当前 vault profile`)
  }
}

async function getConfig () {
  const get = async (key, fallback) => {
    // Explicit process environment wins for temporary overrides.
    if (process.env[key] !== undefined) return process.env[key]
    const value = await getStoredValue(key)
    return value === null || value === undefined ? fallback : value
  }

  return {
    url: await get('URL'),
    apiKey: await get('KEY'),
    model: await get('MODEL'),
    modelsUrl: await get('MODELS_URL'),
    feishuAppId: await get('FEISHU_APP_ID'),
    feishuAppSecret: await get('FEISHU_APP_SECRET'),
    codexBin: await get('CODEX_BIN', 'codex'),
    agentPort: Number(await get('AGENT_PORT', '8787')),
    agentHost: await get('AGENT_HOST', '127.0.0.1')
  }
}

module.exports = { SERVICE, KEYS, getConfig, getStoredValue, saveEnv }

if (require.main === module) {
  if (process.argv[2] !== 'save') {
    console.error('用法: node env-util.js save')
    process.exitCode = 2
  } else {
    saveEnv().catch(error => {
      console.error('保存环境变量失败:', error.message || error)
      process.exitCode = 1
    })
  }
}
