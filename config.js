'use strict'

const { spawn } = require('node:child_process')

const SERVICE = 'feishu-bot'
const KEYS = [
  'URL', 'KEY', 'MODEL', 'MODELS_URL', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET',
  'CODEX_BIN', 'AGENT_PORT', 'AGENT_HOST'
]

// 记录 vault 是否处于可用状态（未安装或未激活 profile 时避免重复尝试子进程）
let vaultAvailable = true

function runVault (args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('vault', args, {
      windowsHide: true,
      shell: process.platform === 'win32'
    })

    let stdout = ''
    let stderr = ''

    if (input !== undefined && input !== null) {
      child.stdin.write(input)
      child.stdin.end()
    }

    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })

    child.on('error', err => {
      reject(new Error(`无法执行 vault 命令：${err.message}`))
    })

    child.on('close', code => {
      if (code !== 0) {
        const detail = (stderr || stdout || '').trim()
        reject(new Error(detail || `vault 命令执行失败，退出码 ${code}`))
        return
      }
      resolve((stdout || '').replace(/\r?\n$/, ''))
    })
  })
}

async function getStoredValue (key) {
  if (!KEYS.includes(key)) {
    throw new Error(`不允许读取未知配置项：${key}`)
  }
  if (!vaultAvailable) {
    return null
  }

  try {
    return await runVault(['read', key])
  } catch (error) {
    const msg = error.message || ''
    // 键不存在为常规缺失，返回 null
    if (/键不存在/.test(msg)) {
      return null
    }
    // 未选择 profile 或未安装 vault 时，标记不可用，降级为 null，避免后续重复阻塞调用
    if (/尚未选择 profile|无法执行 vault 命令|ENOENT/.test(msg)) {
      vaultAvailable = false
      return null
    }
    // 其他非预期异常抛出，方便排查权限等问题
    throw error
  }
}

async function saveEnv () {
  const updates = Object.fromEntries(
    KEYS
      .filter(key => process.env[key] !== undefined)
      .map(key => [key, process.env[key]])
  )

  if (Object.keys(updates).length === 0) {
    throw new Error(`没有发现可保存的环境变量。请先设置以下变量之一：${KEYS.join(', ')}`)
  }

  for (const [key, value] of Object.entries(updates)) {
    await runVault(['write', key, '--stdin'], value)
    console.log(`已保存 ${key} 到当前 vault profile`)
  }
}

async function getConfig () {
  const get = async (key, fallback) => {
    // 显式传入的环境变量优先级最高
    if (process.env[key] !== undefined) {
      return process.env[key]
    }
    const value = await getStoredValue(key)
    return value === null || value === undefined ? fallback : value
  }

  // 并发拉取所有配置项，避免多次启动外部 CLI 导致的串行等待
  const [
    url,
    apiKey,
    model,
    modelsUrl,
    feishuAppId,
    feishuAppSecret,
    codexBin,
    agentPort,
    agentHost
  ] = await Promise.all([
    get('URL'),
    get('KEY'),
    get('MODEL'),
    get('MODELS_URL'),
    get('FEISHU_APP_ID'),
    get('FEISHU_APP_SECRET'),
    get('CODEX_BIN', 'codex'),
    get('AGENT_PORT', '8787'),
    get('AGENT_HOST', '127.0.0.1')
  ])

  return {
    url,
    apiKey,
    model,
    modelsUrl,
    feishuAppId,
    feishuAppSecret,
    codexBin,
    agentPort: Number(agentPort),
    agentHost
  }
}

module.exports = {
  SERVICE,
  KEYS,
  getConfig,
  getStoredValue,
  saveEnv
}

if (require.main === module) {
  saveEnv().catch(error => {
    console.error('保存环境变量失败:', error.message || error)
    process.exitCode = 1
  })
}
