const Chat = require('./chat')

const TOOLS = [
  { type: 'function', function: { name: 'get_system_info', description: '获取运行环境和 agent 工作区信息', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'list_directory', description: '列出 agent 工作区内的目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '工作区内目录的绝对路径' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: '读取 agent 工作区内的 UTF-8 文本文件', parameters: { type: 'object', properties: { path: { type: 'string', description: '工作区内文件的绝对路径' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'write_file', description: '写入 agent 工作区内的 UTF-8 文本文件', parameters: { type: 'object', properties: { path: { type: 'string', description: '工作区内文件的绝对路径' }, content: { type: 'string', description: '要写入的完整文件内容' } }, required: ['path', 'content'], additionalProperties: false } } }
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
  store.updateTask(task.id, { status: 'running', startedAt: new Date().toISOString(), trace: [], messages: [] })
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
      '完成任务后用中文简洁总结结果；若用户要求查询实时/外部信息而工具不具备联网能力，应明确说明限制。'
    ].join('\n')
  })
  const trace = []
  const maxRounds = 12
  try {
    let turn = await consumeTurn(chat.ask(task.prompt))
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
      turn = await consumeTurn(chat.reportCalls(results))
      store.updateTask(task.id, { trace, messages: chat.messages, output: turn.text })
    }
    throw new Error('达到工具调用轮数上限（' + maxRounds + '），任务已停止以避免无限循环。')
  } catch (error) {
    store.updateTask(task.id, { status: 'failed', finishedAt: new Date().toISOString(), exitCode: 1, error: error && error.stack ? error.stack : String(error), trace, messages: chat.messages })
  }
}

module.exports = { runChatTask, TOOLS }
