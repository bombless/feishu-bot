const keytar = require('keytar')
const { SERVICE } = require('./config')

const KEYS = [
  'URL',
  'KEY',
  'MODEL',
  'MODELS_URL',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'CODEX_BIN',
  'AGENT_PORT',
  'AGENT_HOST'
]

;(async () => {
  for (const key of KEYS) {
    const value = process.env[key]
    if (value === undefined) continue

    await keytar.setPassword(SERVICE, key, value)
    console.log(`已保存 ${key}`)
  }
})().catch(error => {
  console.error('保存环境变量失败:', error)
  process.exitCode = 1
})
