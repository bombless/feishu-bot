const keytar = require('keytar')

const SERVICE = 'feishu-bot'

async function getConfig () {
  const get = async (account, fallback) => {
    const value = await keytar.getPassword(SERVICE, account)
    if (value !== null) return value
    return fallback
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

module.exports = { SERVICE, getConfig }
