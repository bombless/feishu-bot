const Chat = require('./chat')

const TOOLS = [
  { type: 'function', function: { name: 'execute_powershell', description: '在 Windows agent 工作区内执行 PowerShell 脚本；需要环境启用命令执行权限', parameters: { type: 'object', properties: { command: { type: 'string', description: '要执行的 PowerShell 脚本内容' }, cwd: { type: 'string', description: '可选的工作目录，必须位于 agent 工作区内' } }, required: ['command'], additionalProperties: false } } },
  { type: 'function', function: { name: 'execute_bash', description: '在 Linux agent 工作区内执行 Bash 命令或脚本；需要环境启用命令执行权限', parameters: { type: 'object', properties: { command: { type: 'string', description: '要执行的 Bash 命令或脚本内容' }, cwd: { type: 'string', description: '可选的工作目录，必须位于 agent 工作区内' } }, required: ['command'], additionalProperties: false } } },
  { type: 'function', function: { name: 'test_proxy_7897', description: '测试本机 HTTP 代理 127.0.0.1:7897 是否可连接，并通过代理请求指定 URL', parameters: { type: 'object', properties: { url: { type: 'string', description: '要通过代理访问的绝对 HTTP 或 HTTPS URL，例如 https://www.google.com' } }, required: ['url'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_system_info', description: '获取运行环境和 agent 工作区信息', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'list_directory', description: '列出 agent 工作区内的目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '工作区内目录的绝对路径' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: '读取 agent 工作区内的 UTF-8 文本文件', parameters: { type: 'object', properties: { path: { type: 'string', description: '工作区内文件的绝对路径' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'write_file', description: '写入 agent 工作区内的 UTF-8 文本文件', parameters: { type: 'object', properties: { path: { type: 'string', description: '工作区内文件的绝对路径' }, content: { type: 'string', description: '要写入的完整文件内容' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'geocode_location', description: '将地名解析为经纬度、国家和时区，使用 Open-Meteo 地理编码服务', parameters: { type: 'object', properties: { location: { type: 'string', description: '城市、地区或地点名称' } }, required: ['location'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_weather_forecast', description: '查询地点当前天气及未来 7 天预报', parameters: { type: 'object', properties: { location: { type: 'string', description: '城市、地区或地点名称' } }, required: ['location'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_historical_weather', description: '查询地点指定日期范围的历史逐日天气，可用于统计晴天、降雨和温度等', parameters: { type: 'object', properties: { location: { type: 'string', description: '城市、地区或地点名称' }, start_date: { type: 'string', description: '开始日期，YYYY-MM-DD' }, end_date: { type: 'string', description: '结束日期，YYYY-MM-DD' }, variables: { type: 'array', items: { type: 'string', enum: ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean', 'sunshine_duration', 'precipitation_sum', 'rain_sum', 'wind_speed_10m_max'] }, description: '可选的逐日指标数组；默认天气代码、最高/最低温度和降水量' }, timezone: { type: 'string', description: '可选时区，例如 Asia/Seoul；默认地点时区' } }, required: ['location', 'start_date', 'end_date'], additionalProperties: false } } }
]

function stringifyResult (value) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

async function consumeTurn (iterator) {
  let text = ''
  const calls = []
  for await (const chunk of iterator) {
    if (chunk.startsWith('t')) text += chunk.slice(1)
    else if (chunk.startsWith('o')) calls.push(JSON.parse(chunk.slice(1)))
  }
  return { text, calls }
}

async function runChatTask (store, task, config) {
  const continuing = Boolean(task.continuePrompt && Array.isArray(task.messages) && task.messages.length)
  store.updateTask(task.id, {
    status: 'running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, error: '',
    ...(continuing ? {} : { trace: [], messages: [] })
  })
  process.env.AGENT_WORKSPACE = process.env.AGENT_WORKSPACE || config.agentWorkspace || (process.platform === 'win32' ? 'D:\\\\mcp-agent-workspace' : '/tmp/mcp-agent-workspace')
  const chat = new Chat({
    url: config.url,
    apiKey: config.apiKey,
    model: config.model,
    modelsUrl: config.modelsUrl,
    tools: TOOLS,
    system: [
      '你是一个可以调用本地 agent 工具的任务执行助手。',
      '需要事实、文件或环境信息时优先使用工具，不要虚构工具执行结果。',
      '工具只能访问 AGENT_WORKSPACE 指定的工作区。遇到工具错误时说明错误并尝试安全的替代方案。',
      '在 Windows 环境下使用 execute_powershell 执行脚本，在 Linux 环境下使用 execute_bash 执行脚本。',
      '天气查询可使用 Open-Meteo 工具：当前天气/预报用 get_weather_forecast，历史逐日数据用 get_historical_weather，地点解析用 geocode_location。统计“晴天”时先说明采用的天气代码或日照时长标准。',
      '完成任务后用中文简洁总结结果；若用户要求查询实时/外部信息而工具不具备联网能力，应明确说明限制。'
    ].join('\n')
  })
  if (continuing) chat.messages = task.messages
  const trace = continuing ? [...(task.trace || [])] : []
  const maxRounds = 12
  try {
    let turn = await chat.askOnce(continuing ? task.continuePrompt : task.prompt)
    if (continuing) {
      store.updateTask(task.id, { prompt: task.prompt + '\n\n追问：' + task.continuePrompt, continuePrompt: null })
    }
    for (let round = 0; round < maxRounds; round++) {
      if (!turn.calls.length) {
        store.updateTask(task.id, { status: 'succeeded', finishedAt: new Date().toISOString(), exitCode: 0, output: turn.text, error: '', trace, messages: chat.messages })
        return
      }
      const results = []
      for (const call of turn.calls) {
        const item = { round: round + 1, id: call.id, name: call.name, arguments: call.arguments, startedAt: new Date().toISOString() }
        try {
          if (!TOOLS.some(t => t.function.name === call.name)) throw new Error('模型请求了未注册的工具: ' + call.name)
          const { runAgentTool, AgentRequestSchema } = await import('@bombless/agent-lib')
          const request = AgentRequestSchema.parse({ type: 'request', id: call.id, tool: call.name, args: call.arguments || {} })
          const result = await runAgentTool(request.tool, request.args, { logCommand: (command, cwd) => console.log('[agent-lib]', command, cwd || '') })
          item.status = 'succeeded'
          item.result = stringifyResult(result)
        } catch (error) {
          item.status = 'failed'
          item.error = error && error.message ? error.message : String(error)
        }
        item.finishedAt = new Date().toISOString()
        trace.push(item)
        results.push({ id: call.id, content: item.status === 'succeeded' ? item.result : '工具执行失败: ' + item.error })
        store.updateTask(task.id, { trace, messages: chat.messages })
      }
      turn = await chat.reportCallsOnce(results)
      store.updateTask(task.id, { trace, messages: chat.messages, output: turn.text })
    }
    throw new Error('达到工具调用轮数上限（' + maxRounds + '），任务已停止以避免无限循环。')
  } catch (error) {
    store.updateTask(task.id, { status: 'failed', finishedAt: new Date().toISOString(), exitCode: 1, error: error && error.stack ? error.stack : String(error), trace, messages: chat.messages })
  }
}

module.exports = { runChatTask, TOOLS }
