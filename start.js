const Lark = require('@larksuiteoapi/node-sdk')
const fs = require('node:fs')
const path = require('node:path')
const CaveGame = require('./module_cave_game')
const Chat = require('./chat')
const MineGame = require('./module_mine_game')
const AgentStore = require('./agent_store')
const { runChatTask } = require('./agent_runner')
const { createAgentServer, listDirectory, normalizeCwd, runCodex } = require('./agent_server')
const { getConfig } = require('./config')
const { attachTaskSummary } = require('./task-summary')

;(async () => {
  const config = await getConfig()
  const chat = new Chat({ url: config.url, apiKey: config.apiKey, model: config.model, modelsUrl: config.modelsUrl })
  // Reconnect silently with a previously stored OAuth token; a fresh login is always initiated explicitly by `mcp connect`.
  const remoteMcp = require('./remote_mcp')
  remoteMcp.restoreStoredSession().then(restored => {
    if (restored) console.log('[MCP] Restored remote MCP session with ' + remoteMcp.tools.length + ' tools')
  }).catch(error => console.error('[MCP] Could not restore saved session; use `mcp connect` to reauthorize:', error?.message || error))
  const filteredModelsPath = path.join(__dirname, 'data', 'filtered-models.json')
  let filteredModels = new Set()
  try {
    const saved = JSON.parse(fs.readFileSync(filteredModelsPath, 'utf8'))
    if (Array.isArray(saved)) filteredModels = new Set(saved.map(String))
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('读取额度不足模型列表失败:', error)
  }
  function saveFilteredModels () {
    fs.mkdirSync(path.dirname(filteredModelsPath), { recursive: true })
    const tempPath = filteredModelsPath + '.tmp'
    fs.writeFileSync(tempPath, JSON.stringify([...filteredModels].sort(), null, 2), 'utf8')
    fs.renameSync(tempPath, filteredModelsPath)
  }
  const modelTests = new Map()
  const baseConfig = { appId: config.feishuAppId, appSecret: config.feishuAppSecret }
  const client = new Lark.Client(baseConfig)
  const runLogPath = path.join(__dirname, 'run.log')
  function writeRunLog (label, outcome, details) {
    const line = `[${new Date().toISOString()}] [card.create:${label}] ${outcome}\n${details}\n`
    try {
      fs.appendFileSync(runLogPath, line, 'utf8')
    } catch (logError) {
      console.error(`[card.create:${label}] failed to write run.log:`, logError?.stack || logError)
    }
  }
  async function createCardWithLogging (label, params) {
    try {
      const response = await client.cardkit.v1.card.create(params)
      const details = JSON.stringify(response, null, 2)
      console.log(`[card.create:${label}] response:\n${details}`)
      writeRunLog(label, 'response', details)
      return response
    } catch (error) {
      console.error(`[card.create:${label}] error:`, error?.stack || error)
      writeRunLog(label, 'error', error?.stack || String(error))
      throw error
    }
  }
  const agentStore = new AgentStore()
  createAgentServer({ store: agentStore, config })
  const chatState = new Map()
  const eventLog = new Map()

  function formatTask (task, includeHistory = false) {
    const output = (task.output || '').trim()
    const errorText = (task.error || '').trim()
    const tail = output ? `\n输出:\n${output.slice(-3000)}` : ''
    const errorSection = errorText ? `\n\n错误信息:\n${errorText.slice(-2000)}` : ''
    const toolHistory = includeHistory ? (task.trace || []).map((item, i) => `\n\n工具调用 ${i + 1}: ${item.name}\n状态: ${item.status}\n参数: ${JSON.stringify(item.arguments || {})}\n${item.status === 'failed' ? '错误: ' + item.error : '结果: ' + (item.result || '')}`).join('') : ''
    const messages = includeHistory ? (task.messages || []).map((message, i) => {
      const calls = message.tool_calls ? '\\n工具请求: ' + message.tool_calls.map(call => call.function.name + '(' + call.function.arguments + ')').join('; ') : ''
      const body = typeof message.content === 'string' ? message.content : ''
      return `\n\n消息 ${i + 1} [${message.role}]${calls}\n${body}`
    }).join('') : ''
    return `ID: ${task.id}\n状态: ${task.status}\n目录: ${task.cwd}\n任务: ${task.prompt}\n创建: ${task.createdAt}${task.startedAt ? `\n开始: ${task.startedAt}` : ''}${task.finishedAt ? `\n结束: ${task.finishedAt}` : ''}${task.exitCode !== null ? `\n退出码: ${task.exitCode}` : ''}${tail}${errorSection}${toolHistory}${messages}`
  }

  function formatHistory (tasks) {
    if (!tasks.length) return '暂无任务历史。'
    return tasks.map((task, i) => `${i + 1}. ${task.id}\n   ${task.status} | ${task.cwd}\n   ${task.prompt.slice(0, 160)}`).join('\n')
  }

  function taskListCard (tasks) {
    // JSON 2.0 cards have a component-count limit; each panel contains two child components.
    const visibleTasks = tasks.slice(0, 60)
    const elements = [
      { tag: 'markdown', content: tasks.length ? `共 ${tasks.length} 个任务，当前展示 ${visibleTasks.length} 个；点击标题可展开详情。` : '暂无任务历史。' }
    ]
    for (const task of visibleTasks) {
      const statusLabel = task.status === 'running' ? '🟡 运行中' : task.status === 'queued' ? '⏳ 排队中' : task.status === 'succeeded' ? '✅ 已完成' : task.status === 'failed' ? '❌ 失败' : `⚪ ${task.status || '未知状态'}`
      const prompt = (task.prompt || '').trim()
      const promptChars = Array.from(prompt)
      const summary = (task.summary || promptChars.slice(0, 8).join('') + (promptChars.length > 8 ? '…' : '') || '（无任务描述）').replace(/\n/g, ' ')
      const created = task.createdAt ? new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false }) : '创建时间未知'
      const detailLines = [
        `**状态：** ${statusLabel}`,
        `**任务 ID：** \`${task.id}\``,
        `**工作目录：** \`${task.cwd || '未知'}\``,
        `**原始任务：** ${prompt || '（无任务描述）'}`,
        `**创建时间：** ${created}${task.finishedAt ? `  |  **结束时间：** ${new Date(task.finishedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}`
      ]
      if (task.exitCode !== null && task.exitCode !== undefined) detailLines.push(`**退出码：** ${task.exitCode}`)
      elements.push({
        tag: 'collapsible_panel',
        expanded: false,
        header: {
          title: { tag: 'plain_text', content: `${created} · ${summary}` },
          vertical_align: 'center',
          width: 'fill'
        },
        border: { color: 'grey', corner_radius: '8px' },
        padding: '8px 12px',
        elements: [
          { tag: 'markdown', content: detailLines.join('\n\n') },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '查看完整详情 / 继续追问' },
            type: 'primary',
            width: 'default',
            size: 'medium',
            behaviors: [{ type: 'callback', value: { action: 'task_id', id: task.id } }]
          }
        ]
      })
    }
    return { card: { data: { schema: '2.0', body: { elements } }, type: 'raw' } }
  }
  function taskDetailCard (task) {
    const content = formatTask(task, true) + '\n\n---\n\n### 继续追问\n输入补充要求后，点击下方按钮，机器人会沿用该任务已有的 Agent 对话继续执行。'
    const elements = [
      { tag: 'markdown', content },
      {
        tag: 'form',
        name: 'task_followup_form',
        elements: [
          { tag: 'input', name: 'followup', placeholder: { tag: 'plain_text', content: '输入追问内容，例如：修复后再运行测试' }, default_value: '', max_length: 1000, width: 'default' },
          { tag: 'button', name: 'submit_followup', form_action_type: 'submit', text: { tag: 'plain_text', content: '继续提问' }, type: 'primary', width: 'default', size: 'medium', behaviors: [{ type: 'callback', value: { action: 'continue_task', id: task.id } }] }
        ]
      }
    ]
    return { card: { data: { schema: '2.0', body: { elements } }, type: 'raw' } }
  }

  function directoryCard (result, page = 1) {
    const pageSize = 80
    const directories = result.entries.filter(x => x.type === 'directory')
    const files = result.entries.filter(x => x.type !== 'directory')
    const entries = [...directories, ...files]
    const totalPages = Math.max(1, Math.ceil(entries.length / pageSize))
    const currentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages)
    const pageEntries = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    const pageDirectories = pageEntries.filter(x => x.type === 'directory')
    const pageFiles = pageEntries.filter(x => x.type !== 'directory')

    const elements = [
      { tag: 'markdown', content: `**当前目录**\n\`${result.cwd}\`\n\n第 ${currentPage}/${totalPages} 页，共 ${entries.length} 项` }
    ]
    const parent = normalizeCwd(result.cwd + '\\..')
    if (parent.toLowerCase() !== result.cwd.toLowerCase()) {
      elements.push({
        tag: 'button',
        text: { tag: 'plain_text', content: '⬆️ 上一级' },
        type: 'default',
        width: 'default',
        size: 'medium',
        behaviors: [{ type: 'callback', value: { action: 'd_directory', cwd: parent, page: 1 } }]
      })
    }

    for (const entry of pageDirectories) {
      const cwd = normalizeCwd(result.cwd + '\\' + entry.name)
      elements.push({
        tag: 'button',
        text: { tag: 'plain_text', content: `📁 ${entry.name}` },
        type: 'primary',
        width: 'default',
        size: 'medium',
        behaviors: [{ type: 'callback', value: { action: 'd_directory', cwd, page: 1 } }]
      })
    }

    if (pageFiles.length) {
      elements.push({
        tag: 'markdown',
        content: `**文件**\n${pageFiles.map(x => `📄 ${x.name}`).join('\n')}`
      })
    }

    if (!entries.length) {
      elements.push({ tag: 'markdown', content: '（空目录）' })
    }

    if (totalPages > 1) {
      const navigation = []
      if (currentPage > 1) {
        navigation.push({
          tag: 'button',
          text: { tag: 'plain_text', content: '⬅️ 上一页' },
          type: 'default',
          width: 'default',
          size: 'medium',
          behaviors: [{ type: 'callback', value: { action: 'd_directory', cwd: result.cwd, page: currentPage - 1 } }]
        })
      }
      if (currentPage < totalPages) {
        navigation.push({
          tag: 'button',
          text: { tag: 'plain_text', content: '下一页 ➡️' },
          type: 'default',
          width: 'default',
          size: 'medium',
          behaviors: [{ type: 'callback', value: { action: 'd_directory', cwd: result.cwd, page: currentPage + 1 } }]
        })
      }
      elements.push({ tag: 'column_set', flex_mode: 'none', horizontal_spacing: 'small', columns: navigation.map(button => ({ tag: 'column', width: 'weighted', weight: 1, elements: [button] })) })
    }

    return {
      card: {
        data: {
          schema: '2.0',
          body: { elements }
        },
        type: 'raw'
      }
    }
  }

  const wsClient = new Lark.WSClient({ ...baseConfig, loggerLevel: Lark.LoggerLevel.debug })
  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      'card.action.trigger': async data => {
        const timeStart = process.hrtime.bigint()
        console.log('[card.action.trigger] received:', JSON.stringify({ action: data?.action, context: data?.context, event: data?.event }, null, 2))
        try {
        const { action: { value }, context: { open_chat_id } } = data
        if (value.action === 'set_model') {
          chat.model = value.model
          const meta = value.meta
          const markdown = '- ' + Object.keys(meta).filter(x => meta[x] && !(meta[x] instanceof Object)).map(x => x + ': ' + meta[x]).join('\n- ')
          return { card: { data: { schema: '2.0', body: { elements: [
            { tag: 'div', text: { tag: 'plain_text', content: '模型被设置为' + value.model } },
            { tag: 'markdown', content: markdown }
          ] } }, type: 'raw' } }
        }
        if (value.action === 'test_models') {
          const test = modelTests.get(value.testId)
          if (!test) return { toast: { type: 'error', content: '测试任务已过期，请重新发送 models 命令。' } }
          modelTests.delete(value.testId)
          ;(async () => {
            const quotaModels = []
            const failures = []
            let successfulModels = 0
            for (const model of test.models) {
              try {
                const probe = chat.clone({ model: model.model })
                await probe.testQuota('你好')
                successfulModels++
              } catch (error) {
                const message = String(error?.message || error)
                if (/insufficient[_ -]?quota|quota[_ -]?exceeded|额度不足|余额不足|insufficient balance/i.test(message)) {
                  quotaModels.push(model)
                  filteredModels.add(String(model.model))
                  try { saveFilteredModels() } catch (saveError) { console.error('保存额度不足模型列表失败:', saveError) }
                } else {
                  failures.push(`${model.name || model.model}: ${message.slice(0, 180)}`)
                }
              }
            }
            const report = `模型额度检测完成\n本次检测：${test.models.length} 个模型\n正常完成请求：${successfulModels} 个模型\n检测到额度不足：${quotaModels.length} 个模型\n` +
              (quotaModels.length ? `\n已过滤模型：\n${quotaModels.map(x => `- ${x.name || x.model} (${x.model})`).join('\n')}\n` : '\n未检测到额度不足的模型。\n') +
              `\n当前累计过滤：${filteredModels.size} 个模型` +
              (failures.length ? `\n\n其他检测失败（无法判定额度状态）：\n${failures.join('\n')}` : '')
            try {
              await client.im.v1.message.create({
                params: { receive_id_type: 'chat_id' },
                data: { receive_id: test.chatId, msg_type: 'text', content: JSON.stringify({ text: report }) }
              })
            } catch (sendError) { console.error('发送模型额度检测报告失败:', sendError?.stack || sendError) }
          })().catch(error => console.error('模型额度检测任务失败:', error?.stack || error))
          return { toast: { type: 'success', content: `已开始检测 ${test.models.length} 个模型，完成后会另发报告。` } }
        }
        if (value.action === 'task_id') {
          const task = agentStore.getTask(value.id)
          if (!task) {
            return { card: { data: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: `**找不到任务**\n${value.id}` }] } }, type: 'raw' } }
          }
          // Returning a card from the card-action callback updates the existing card in place.
          // The callback event does not include a card_id, so do not call CardKit card.update here.
          return taskDetailCard(task)
        }
        if (value.action === 'continue_task') {
          const task = agentStore.getTask(value.id)
          const formValue = data.action?.form_value || data.action?.formValue || {}
          const prompt = String(formValue.followup || '').trim()
          if (!task) return { card: { data: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: `**找不到任务**\\n${value.id}` }] } }, type: 'raw' } }
          if (!prompt) return { card: { data: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: '请先输入追问内容，再点击“继续提问”。' }] } }, type: 'raw' } }
          if (task.status === 'running' || task.status === 'queued') return { card: { data: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: '该任务仍在运行中，请完成后再继续追问。' }] } }, type: 'raw' } }
          if (!Array.isArray(task.messages) || !task.messages.length) return { card: { data: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: '该任务没有可续接的 Agent 对话历史。' }] } }, type: 'raw' } }
          agentStore.updateTask(task.id, { continuePrompt: prompt })
          runChatTask(agentStore, agentStore.getTask(task.id), Object.assign({}, config, { model: chat.model }))
          return { card: { data: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: `已提交追问，正在沿用原对话继续执行。\n\n**任务 ID：** ${task.id}\n\n完成后再次输入 id ${task.id} 查看结果或继续提问。` }] } }, type: 'raw' } }
        }
        if (value.action === 'd_directory') {
          try {
            const result = listDirectory(value.cwd)
            const elapsed = Number(process.hrtime.bigint() - timeStart) / 1e6
            console.log('time', elapsed.toFixed(3), 'ms')
            return directoryCard(result, value.page)
          } catch (e) {
            return {
              card: {
                data: {
                  schema: '2.0',
                  body: { elements: [{ tag: 'markdown', content: `**目录读取失败**\n${e.message}` }] }
                },
                type: 'raw'
              }
            }
          }
        }
        let ret = undefined
        if (value.action === 'mine_position') ret = chatState.get(open_chat_id).chat(value)
        if (value.action === 'cave') ret = { card: { data: chatState.get(open_chat_id).ask(value.choice), type: 'raw' } }
        const elapsed = Number(process.hrtime.bigint() - timeStart) / 1e6
        console.log('time', elapsed.toFixed(3), 'ms')
        return ret
        } catch (error) {
          console.error('[card.action.trigger] handler error:', error?.stack || error)
          return { toast: { type: 'error', content: '处理卡片操作失败，请查看机器人日志。' } }
        }
      },
      'im.message.receive_v1': async data => {
        const { event_id, message: { chat_id, content, create_time, message_id }, sender } = data
        if (create_time * 1000 + 10000 < +new Date()) return
        if (eventLog.has(event_id)) return
        eventLog.set(event_id, event_id)
        const cmd = JSON.parse(content).text.trim()
        if (cmd === '.quit') chatState.delete(chat_id)

        let responseTitle
        let responseContent
        let card_id
        const parts = cmd.split(/\s+/)
        const command = parts[0].toLowerCase()

        try {
          if (command === 'mcp') {
            const action = (parts[1] || 'status').toLowerCase()
            if (action === 'connect') {
              responseTitle = '正在连接远程 MCP'
              responseContent = '浏览器将打开 OAuth 授权页。请在网页中完成登录和六位数 2FA 验证；授权完成后机器人会自动发现工具。此过程可能需要几分钟。'
              // Send the authorization URL to the chat so 2FA can be completed even if the bot host has no desktop browser.
              remoteMcp.onAuthUrl = url => client.im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chat_id, msg_type: 'text', content: JSON.stringify({ text: '请打开以下 OAuth 链接并完成网页中的六位数 2FA 验证：\\n' + url }) } }).catch(error => console.error('[MCP] send OAuth URL failed:', error?.message || error))
              // Start authorization without blocking the Feishu reply; completion/failure is reported asynchronously.
              remoteMcp.connect().then(result => {
                const report = '远程 MCP 已连接，发现 ' + result.tools + ' 个工具。可用 mcp status 查看状态。'
                return client.im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chat_id, msg_type: 'text', content: JSON.stringify({ text: report }) } })
              }).catch(error => {
                console.error('[MCP] connect failed:', error?.stack || error)
                return client.im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chat_id, msg_type: 'text', content: JSON.stringify({ text: '远程 MCP 连接失败：' + error.message }) } }).catch(() => {})
              })
            } else if (action === 'disconnect') {
              await remoteMcp.disconnect()
              responseTitle = '远程 MCP 已断开'
              responseContent = '已清除本机保存的 OAuth token，并停止向 Agent 提供远程工具。'
            } else if (action === 'status') {
              const status = remoteMcp.status()
              responseTitle = '远程 MCP 状态'
              responseContent = status.connected
                ? '已连接，发现 ' + status.tools.length + ' 个工具：\\n' + status.tools.join('\\n')
                : '当前未连接。发送 mcp connect 开始 OAuth 授权。'
            } else {
              throw new Error('用法：mcp connect | mcp disconnect | mcp status')
            }
          } else if (command === 'd' || command === 'ls' || command === 'dir') {
            const target = cmd.slice(command.length).trim() || 'D:\\'
            const result = listDirectory(target)
            responseTitle = 'D盘目录'
            responseContent = null
            card_id = await createCardWithLogging('directory', {
              data: {
                type: 'card_json',
                data: JSON.stringify(directoryCard(result).card.data)
              }
            }).then(res => res.data.card_id)
          } else if (command === 'task') {
            const raw = cmd.slice(command.length).trim()
            const separator = raw.indexOf('::')
            const match = separator >= 0 ? [raw.slice(0, separator).trim(), raw.slice(separator + 2).trim()] : null
            if (!match || !match[0] || !match[1]) throw new Error('用法: task D:\\项目目录 :: 任务描述（路径含空格时也可用此格式）')
            const cwd = normalizeCwd(match[0])
            const task = agentStore.createTask({ chatId: chat_id, senderId: sender?.sender_id?.open_id, cwd, prompt: match[1] })
            attachTaskSummary(agentStore, task, config)
            runCodex(agentStore, task, config)
            responseTitle = '任务已开启'
            responseContent = formatTask(task) + '\n\n可用 history 查看历史。'
          } else if (command === 'run') {
            const prompt = cmd.slice(command.length).trim()
            if (!prompt) throw new Error('用法: run <任务描述>')
            const cwd = config.agentWorkspace || (process.platform === 'win32' ? 'D:\\\\mcp-agent-workspace' : '/tmp/mcp-agent-workspace')
            const task = agentStore.createTask({ chatId: chat_id, senderId: sender?.sender_id?.open_id, cwd, prompt })
            attachTaskSummary(agentStore, task, Object.assign({}, config, { model: chat.model }))
            runChatTask(agentStore, task, Object.assign({}, config, { model: chat.model }))
            responseTitle = '模型 Agent 任务已开启'
            responseContent = formatTask(task) + '\n\n可用 list 查看任务状态，id ' + task.id + ' 查看消息和工具调用历史。'
          } else if (command === 'list' || command === 'history' || command === 'tasks') {
            responseTitle = 'Agent 任务历史'
            card_id = await createCardWithLogging('task-list', {
              data: {
                type: 'card_json',
                data: JSON.stringify(taskListCard(agentStore.listTasks(parts[1] || 20)).card.data)
              }
            }).then(res => res.data.card_id)
            responseContent = null
          } else if (command === 'id' || command === 'taskinfo') {
            const task = agentStore.getTask(parts[1])
            if (!task) throw new Error('找不到任务: ' + (parts[1] || ''))
            responseTitle = '任务详情'
            card_id = await createCardWithLogging('task-detail', {
              data: { type: 'card_json', data: JSON.stringify(taskDetailCard(task).card.data) }
            }).then(res => res.data.card_id)
            responseContent = null
          } else {
            switch (cmd) {
              case 'mine': {
                const game = new MineGame(client, chat_id); chatState.set(chat_id, game); card_id = await game.prompt(); break
              }
              case 'cave': {
                const game = new CaveGame(client, chat.clone()); chatState.set(chat_id, game); card_id = await game.prompt(); break
              }
              default:
                if (cmd.startsWith('models')) {
                  const search = cmd.startsWith('models ') ? cmd.slice('models '.length) : ''
                  await chat.models(search).then(async ({ output: { models } }) => {
                    models = models.filter(x => x.features.includes('web-search')).filter(x => x.published_time > '2026-05-20').filter(x => !filteredModels.has(String(x.model)))
                    models.sort((a, b) => a.published_time < b.published_time ? 1 : -1)
                    const testId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
                    modelTests.set(testId, { chatId: chat_id, models: models.map(x => ({ model: x.model, name: x.name })) })
                    const elements = [{ tag: 'button', text: { tag: 'plain_text', content: '《测试》' }, type: 'danger', width: 'default', size: 'medium', behaviors: [{ type: 'callback', value: { action: 'test_models', testId } }] }, ...models.map(x => ({ tag: 'button', text: { tag: 'plain_text', content: x.name }, type: 'primary', width: 'default', size: 'medium', behaviors: [{ type: 'callback', value: { action: 'set_model', model: x.model, meta: x } }] }))]
                    const res = await createCardWithLogging('models', { data: { type: 'card_json', data: JSON.stringify({ schema: '2.0', body: { elements } }) } })
                    card_id = res.data.card_id
                  })
                  responseTitle = '模型列表'
                } else {
                  responseTitle = '帮助目录'
                  responseContent = `help 本帮助目录；\nmcp connect/disconnect/status 连接、断开和查看远程 MCP；\ncave 洞穴游戏；\nmodels 模型列表；\nmine 扫雷游戏；\nd [D:\\路径] 列举 D 盘目录；\ntask D:\\路径 :: 任务描述 派发 codex exec 任务；\nrun <任务描述> 使用当前模型和工具循环执行任务；\nlist [数量] 查询持久化任务状态；\nid <任务ID> 查询任务消息和工具调用历史；\nhistory [数量] 查询任务历史；\ntaskinfo <任务ID> 查询任务详情；`
                }
            }
          }
        } catch (e) {
          responseTitle = 'Agent 操作失败'
          responseContent = e.message
        }

        const cardContent = card_id
          ? JSON.stringify({ type: 'card', data: { card_id } })
          : Lark.messageCard.defaultCard({ title: responseTitle, content: responseContent })
        const ret = await client.im.v1.message.reply({ path: { message_id }, data: { receive_id: chat_id, content: cardContent, msg_type: 'interactive' } })
        const new_message_id = ret?.data?.message_id
        const modu = chatState.get(chat_id)
        if (typeof modu?.setMessageId === 'function') modu.setMessageId(new_message_id)
      }
    })
  })

  console.log('🤖 飞书机器人已启动（长连接模式）')
})().catch(error => {
  console.error('启动失败:', error)
  process.exitCode = 1
})
