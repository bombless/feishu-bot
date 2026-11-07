const Lark = require('@larksuiteoapi/node-sdk')
const fs = require('node:fs')
const { capturePhoto, captureVideo, captureExternalVideo, analyzeVideoMotion } = require('./photo')
const { captureAudio } = require('./audio')
const os = require('node:os')
const path = require('node:path')
const { randomInt, timingSafeEqual } = require('node:crypto')
const CaveGame = require('./module_cave_game')
const Chat = require('./chat')
const MineGame = require('./module_mine_game')
const AgentStore = require('./agent_store')
const { runChatTask } = require('./agent_runner')
const { listDirectory, normalizeCwd, runCodex } = require('./agent_server')
const { getConfig } = require('./env-util')
const { attachTaskSummary } = require('./task-summary')

;(async () => {
  const config = await getConfig()
  const cameraOtp = String(randomInt(0, 1000000)).padStart(6, '0')
  const cameraOtpExpiresAt = Date.now() + 5 * 60 * 1000
  let cameraOtpConsumed = false
  let cameraOtpFailedAttempts = 0
  const configuredCameraOpenIds = new Set((process.env.PHOTO_ALLOWED_OPEN_IDS || '').split(',').map(x => x.trim()).filter(Boolean))
  const cameraAuthorizedOpenIds = new Set()

  function isCameraAuthorized (openId) {
    return Boolean(openId && (configuredCameraOpenIds.has(openId) || cameraAuthorizedOpenIds.has(openId)))
  }

  console.log('🔐 音视频采集授权 OTP：' + cameraOtp + '（5 分钟内发送 otp ' + cameraOtp + ' 完成授权；仅首个验证成功的用户可绑定）')
  const chat = new Chat({ url: config.url, apiKey: config.apiKey, model: config.model, modelsUrl: config.modelsUrl })
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
  const chatState = new Map()
  const eventLog = new Map()
  const videoMonitors = new Map()
  const videoStatsByChat = new Map()
  const MOTION_THRESHOLD = 6

  function cpuSnapshot () {
    return os.cpus().reduce((total, cpu) => {
      const times = cpu.times
      const busy = times.user + times.nice + times.sys + times.irq
      return { busy: total.busy + busy, idle: total.idle + times.idle }
    }, { busy: 0, idle: 0 })
  }

  function cpuPercentBetween (before, after) {
    const busy = after.busy - before.busy
    const total = busy + (after.idle - before.idle)
    return total > 0 ? busy / total * 100 : 0
  }

  async function sendMonitorText (chatId, text) {
    return client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) }
    })
  }

  async function sendMonitorVideo (chatId, videoPath, duration = 10000) {
    const upload = await client.im.v1.file.create({
      data: {
        file_type: 'mp4',
        file_name: path.basename(videoPath),
        file: fs.createReadStream(videoPath),
        duration
      }
    })
    const fileKey = upload?.file_key || upload?.data?.file_key
    if (!fileKey) throw new Error(`上传监控视频失败：${upload?.msg || '没有返回 file_key'}`)
    return client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'media', content: JSON.stringify({ file_key: fileKey, duration }) }
    })
  }

  async function runVideoMonitor (chatId, senderOpenId, device, sourceId) {
    const monitorKey = `${chatId}:${sourceId}`
    const state = videoMonitors.get(monitorKey)
    const videosDir = path.join(__dirname, 'videos')
    while (videoMonitors.get(monitorKey) === state && state.running) {
      let videoPath
      const startedAt = Date.now()
      const memoryStart = process.memoryUsage().rss
      let peakRss = memoryStart
      let peakSystemCpu = 0
      let peakSystemMemoryBytes = os.totalmem() - os.freemem()
      const sampleCpu = () => {
        const next = cpuSnapshot()
        peakSystemCpu = Math.max(peakSystemCpu, cpuPercentBetween(sampleCpu.previous, next))
        sampleCpu.previous = next
        peakRss = Math.max(peakRss, process.memoryUsage().rss)
        peakSystemMemoryBytes = Math.max(peakSystemMemoryBytes, os.totalmem() - os.freemem())
      }
      sampleCpu.previous = cpuSnapshot()
      const sampler = setInterval(sampleCpu, 500)
      try {
        videoPath = sourceId === '1'
          ? await captureExternalVideo('monitor-1')
          : await captureVideo(device, 'monitor-0')
        const motion = await analyzeVideoMotion(videoPath, MOTION_THRESHOLD)
        sampleCpu()
        clearInterval(sampler)
        const stat = fs.statSync(videoPath)
        const metrics = {
          path: videoPath,
          sizeBytes: stat.size,
          durationMs: Date.now() - startedAt,
          memoryPeakBytes: peakRss,
          memoryDeltaBytes: Math.max(0, peakRss - memoryStart),
          systemMemoryPeakBytes: peakSystemMemoryBytes,
          systemMemoryTotalBytes: os.totalmem(),
          systemMemoryPeakPercent: Number((peakSystemMemoryBytes / os.totalmem() * 100).toFixed(1)),
          systemCpuPeak: Number(peakSystemCpu.toFixed(1)),
          motionScore: motion.score,
          moving: motion.moving,
          at: new Date().toISOString()
        }
        videoStatsByChat.set(monitorKey, metrics)

        // Keep only the latest monitor clip, including across bot restarts.
        for (const name of fs.readdirSync(videosDir)) {
          if (name.startsWith(`monitor-${sourceId}-`) && path.join(videosDir, name) !== videoPath) {
            try { fs.rmSync(path.join(videosDir, name), { force: true }) } catch (cleanupError) {
              console.warn('清理旧监控视频失败:', cleanupError?.message || cleanupError)
            }
          }
        }

        if (motion.moving) {
          await sendMonitorText(chatId, `🐾 检测到画面有明显运动！\n运动分数：${motion.score}（阈值 ${MOTION_THRESHOLD}）\n视频：${path.basename(videoPath)}`)
          await sendMonitorVideo(chatId, videoPath)
        }
      } catch (error) {
        clearInterval(sampler)
        console.error('[vid.monitor] monitoring failed:', error?.stack || error)
        try { await sendMonitorText(chatId, `视频监控遇到错误，已自动停止：${error.message}`) } catch (sendError) {
          console.error('[vid.monitor] error notification failed:', sendError?.message || sendError)
        }
        state.running = false
        break
      }
    }
    if (videoMonitors.get(monitorKey) === state) videoMonitors.delete(monitorKey)
    if (!state.running) console.log(`[vid.monitor] stopped for chat ${chatId}`)
  }

  const taskThreadQueues = new Map()

  function extractThreadItems (messages) {
    if (!Array.isArray(messages)) return []
    const toolCallsMap = new Map()
    for (const msg of messages) {
      if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
          if (call?.id) {
            toolCallsMap.set(call.id, {
              name: call.function?.name || '未知工具',
              arguments: call.function?.arguments
            })
          }
        }
      }
    }

    const items = []
    for (const msg of messages) {
      if (!msg || msg.role === 'system') continue

      if (msg.role === 'user') {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '')
        items.push({
          type: 'user',
          title: '💬 用户输入',
          content: content.trim()
        })
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string' && msg.content.trim()) {
          items.push({
            type: 'assistant',
            title: '🤖 Agent 助手',
            content: msg.content.trim()
          })
        }
        if (Array.isArray(msg.tool_calls)) {
          for (const call of msg.tool_calls) {
            const toolName = call.function?.name || '未知工具'
            const rawArgs = call.function?.arguments
            let formattedArgs = ''
            try {
              const parsed = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {})
              formattedArgs = JSON.stringify(parsed, null, 2)
            } catch {
              formattedArgs = String(rawArgs || '{}')
            }
            items.push({
              type: 'tool_call',
              title: `🛠️ 工具调用 · ${toolName}`,
              content: formattedArgs ? `参数：\n${formattedArgs}` : '无参数'
            })
          }
        }
      } else if (msg.role === 'tool') {
        const callInfo = msg.tool_call_id ? toolCallsMap.get(msg.tool_call_id) : null
        const toolName = callInfo?.name || '未知工具'
        const rawContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '')
        items.push({
          type: 'tool_result',
          title: `📋 工具结果 · ${toolName}`,
          content: rawContent.trim()
        })
      }
    }
    return items
  }

  function formatThreadItem (item, index, total) {
    const header = `【${item.title}】（${index + 1}/${total}）`
    let body = (item.content || '').trim()
    if (!body) body = '(无内容)'
    const maxLen = 16 * 1024
    if (Buffer.byteLength(body, 'utf8') > maxLen) {
      body = body.slice(0, 4000) + '\n\n…（内容过长，已截断展示）'
    }
    return `${header}\n\n${body}`
  }

  function queueTaskThreadSync (taskId) {
    const previous = taskThreadQueues.get(taskId) || Promise.resolve()
    const next = previous.then(async () => {
      while (true) {
        const task = agentStore.getTask(taskId)
        if (!task?.threadRootMessageId) return
        const messages = Array.isArray(task.messages) ? task.messages : []
        const items = extractThreadItems(messages)
        const cursor = Number(task.threadPublishedMessageIndex) || 0
        if (cursor >= items.length) return
        const item = items[cursor]
        const text = formatThreadItem(item, cursor, items.length)
        const replyRes = await client.im.v1.message.reply({
          path: { message_id: task.threadRootMessageId },
          data: {
            msg_type: 'text',
            content: JSON.stringify({ text }),
            reply_in_thread: true
          }
        })
        if (replyRes?.code && replyRes.code !== 0) {
          console.error(`[task.thread:${taskId}] reply failed (code ${replyRes.code}): ${replyRes.msg}`)
          if (replyRes.code === 230071) {
            const fallbackRes = await client.im.v1.message.reply({
              path: { message_id: task.threadRootMessageId },
              data: {
                msg_type: 'text',
                content: JSON.stringify({ text })
              }
            })
            if (fallbackRes?.code && fallbackRes.code !== 0) {
              console.error(`[task.thread:${taskId}] fallback reply failed (code ${fallbackRes.code}): ${fallbackRes.msg}`)
              return
            }
          } else {
            return
          }
        }
        await new Promise(resolve => setTimeout(resolve, 220))
        agentStore.updateTask(taskId, { threadPublishedMessageIndex: cursor + 1 })
      }
    }).catch(error => {
      console.error(`[task.thread:${taskId}] publish failed:`, error?.stack || error)
    }).finally(() => {
      if (taskThreadQueues.get(taskId) === next) taskThreadQueues.delete(taskId)
    })
    taskThreadQueues.set(taskId, next)
    return next
  }

  async function startRunTask (prompt, chatId, senderId, appConfig, chatModel) {
    const cwd = appConfig.agentWorkspace || (process.platform === 'win32' ? 'D:\\\\mcp-agent-workspace' : '/tmp/mcp-agent-workspace')
    const task = agentStore.createTask({ chatId, senderId, cwd, prompt })
    attachTaskSummary(agentStore, task, Object.assign({}, appConfig, { model: chatModel }))
    
    const onComplete = async (completedTask) => {
      try {
        if (taskThreadQueues.has(completedTask.id)) {
          try { await taskThreadQueues.get(completedTask.id) } catch (queueErr) {
            console.error(`[task.thread:${completedTask.id}] queue wait error:`, queueErr?.stack || queueErr)
          }
        }
        const resultText = `Agent 任务执行完成\n\n**任务：** ${completedTask.prompt}\n**状态：** ${completedTask.status === 'succeeded' ? '✅ 成功' : '❌ 失败'}\n\n**输出结果：**\n` + (completedTask.output || completedTask.error || '(无输出)')
        const latestTask = agentStore.getTask(completedTask.id)
        if (latestTask?.threadRootMessageId) {
          const replyRes = await client.im.v1.message.reply({
            path: { message_id: latestTask.threadRootMessageId },
            data: { msg_type: 'text', content: JSON.stringify({ text: resultText.slice(-4000) }), reply_in_thread: true }
          })
          if (replyRes?.code === 230071) {
            await client.im.v1.message.reply({
              path: { message_id: latestTask.threadRootMessageId },
              data: { msg_type: 'text', content: JSON.stringify({ text: resultText.slice(-4000) }) }
            })
          }
        } else {
          await client.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: chatId,
              msg_type: 'text',
              content: JSON.stringify({ text: resultText.slice(-4000) })
            }
          })
        }
      } catch (notifyErr) {
        console.error('发送任务完成通知失败:', notifyErr?.stack || notifyErr)
      }
    }

    runChatTask(agentStore, task, Object.assign({}, appConfig, { model: chatModel }), onComplete, async (taskId) => queueTaskThreadSync(taskId))
    return task
  }

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
  function truncateMarkdown (content, maxBytes = 20 * 1024) {
    const text = String(content || '')
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
    const suffix = '\n\n…（Markdown 内容过长，已截断）'
    const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, 'utf8'))
    let truncated = ''
    let bytes = 0
    for (const char of text) {
      const charBytes = Buffer.byteLength(char, 'utf8')
      if (bytes + charBytes > budget) break
      truncated += char
      bytes += charBytes
    }
    return truncated + suffix
  }

  function taskDetailCard (task) {
    const threadNote = task.threadRootMessageId
      ? '\n\n*(Agent 执行详情已同步至话题回复)*'
      : '\n\n*(Agent 执行详情将同步至话题回复)*'
    const content = truncateMarkdown(formatTask(task, false) + threadNote + '\n\n---\n\n### 继续追问\n输入补充要求后，点击下方按钮，机器人会沿用该任务已有的 Agent 对话继续执行。')
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
          const onFollowupComplete = async (completedTask) => {
            try {
              if (taskThreadQueues.has(completedTask.id)) {
                try { await taskThreadQueues.get(completedTask.id) } catch (queueErr) {
                  console.error(`[task.thread:${completedTask.id}] queue wait error:`, queueErr?.stack || queueErr)
                }
              }
              const resultText = `Agent 追问执行完成\n\n**任务：** ${completedTask.prompt}\n**状态：** ${completedTask.status === 'succeeded' ? '✅ 成功' : '❌ 失败'}\n\n**输出结果：**\n` + (completedTask.output || completedTask.error || '(无输出)')
              const latestTask = agentStore.getTask(completedTask.id)
              if (latestTask?.threadRootMessageId) {
                const replyRes = await client.im.v1.message.reply({
                  path: { message_id: latestTask.threadRootMessageId },
                  data: { msg_type: 'text', content: JSON.stringify({ text: resultText.slice(-4000) }), reply_in_thread: true }
                })
                if (replyRes?.code === 230071) {
                  await client.im.v1.message.reply({
                    path: { message_id: latestTask.threadRootMessageId },
                    data: { msg_type: 'text', content: JSON.stringify({ text: resultText.slice(-4000) }) }
                  })
                }
              }
            } catch (notifyErr) {
              console.error('发送追问完成通知失败:', notifyErr?.stack || notifyErr)
            }
          }
          runChatTask(agentStore, agentStore.getTask(task.id), Object.assign({}, config, { model: chat.model }), onFollowupComplete, async (taskId) => queueTaskThreadSync(taskId))
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
        let taskForThread = null
        let photoImageKey = null
        let videoFileKey = null
        let audioFileKey = null
        const parts = cmd.split(/\s+/)
        const command = parts[0].toLowerCase()

        const KNOWN_COMMANDS = ['d', 'ls', 'dir', 'task', 'run', 'list', 'history', 'tasks', 'id', 'taskinfo', 'mine', 'cave', 'models', 'otp', 'photo', 'vid', 'audio', 'help']
        const isKnownCommand = KNOWN_COMMANDS.includes(command) || cmd.startsWith('models')

        try {
          if (!isKnownCommand) {
            const task = await startRunTask(cmd, chat_id, sender?.sender_id?.open_id, config, chat.model)
            responseTitle = '模型 Agent 任务已自动开启'
            responseContent = formatTask(task) + '\n\n正在后台执行，执行完毕后将直接发送结果。'
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
          } else if (command === 'otp') {
            const senderOpenId = sender?.sender_id?.open_id
            const submittedOtp = parts[1] || ''
            if (!senderOpenId) throw new Error('无法识别发送者身份，OTP 授权失败。')
            if (isCameraAuthorized(senderOpenId)) {
              responseTitle = '音视频采集权限已授权'
              responseContent = '当前发送者已经有 photo、vid、audio 使用权限。'
            } else if (cameraOtpConsumed) {
              throw new Error('本次启动的 OTP 已使用或失效。请重启机器人获取新的 OTP。')
            } else if (Date.now() > cameraOtpExpiresAt) {
              cameraOtpConsumed = true
              throw new Error('OTP 已超过 5 分钟有效期，请重启机器人获取新的 OTP。')
            } else if (cameraOtpFailedAttempts >= 5) {
              cameraOtpConsumed = true
              throw new Error('OTP 错误次数过多，本次验证码已失效。请重启机器人获取新的 OTP。')
            } else if (!/^[0-9]{6}$/.test(submittedOtp) || !timingSafeEqual(Buffer.from(submittedOtp), Buffer.from(cameraOtp))) {
              cameraOtpFailedAttempts += 1
              if (cameraOtpFailedAttempts >= 5) cameraOtpConsumed = true
              throw new Error('OTP 不正确（剩余尝试次数：' + Math.max(0, 5 - cameraOtpFailedAttempts) + '）。')
            } else {
              cameraOtpConsumed = true
              cameraAuthorizedOpenIds.add(senderOpenId)
              responseTitle = '音视频采集权限授权成功'
              responseContent = '当前飞书账号已绑定，可直接使用 photo、vid、audio。授权持续到机器人进程退出或重启。'
            }
          } else if (command === 'photo') {
            const senderOpenId = sender?.sender_id?.open_id
            if (!isCameraAuthorized(senderOpenId)) {
              throw new Error('photo 命令未授权。请先发送 otp <6位验证码> 完成授权，或配置 PHOTO_ALLOWED_OPEN_IDS。')
            }
            const imagePath = await capturePhoto(parts.slice(1).join(' ').trim() || undefined)
            try {
              const upload = await client.im.v1.image.create({
                data: { image_type: 'message', image: fs.createReadStream(imagePath) }
              })
              // The Feishu SDK image.create() returns the API response's `data` payload directly,
              // so image_key is normally at the top level. Keep the nested path as a compatibility fallback.
              photoImageKey = upload?.image_key || upload?.data?.image_key
              if (!photoImageKey) {
                const detail = [upload?.code != null ? `code=${upload.code}` : '', upload?.msg ? `msg=${upload.msg}` : '', `responseKeys=${Object.keys(upload || {}).join(',') || '(empty)'}`].filter(Boolean).join('; ')
                throw new Error(`飞书图片上传失败：没有返回 image_key。${detail ? ` 接口响应：${detail}` : ''}`)
              }
            } finally {
              try { fs.rmSync(imagePath, { force: true }) } catch (cleanupError) {
                console.warn('清理临时照片失败:', cleanupError?.message || cleanupError)
              }
            }
            responseTitle = '摄像头照片'
            responseContent = '已拍摄当前画面。'
          } else if (command === 'vid') {
            const senderOpenId = sender?.sender_id?.open_id
            if (!isCameraAuthorized(senderOpenId)) {
              throw new Error('vid 命令未授权。请先发送 otp <6位验证码> 完成授权，或配置 PHOTO_ALLOWED_OPEN_IDS。')
            }
            const firstArg = (parts[1] || '').toLowerCase()
            const explicitSource = firstArg === '0' || firstArg === '1'
            const sourceId = explicitSource ? firstArg : '0'
            const subcommand = explicitSource ? (parts[2] || '').toLowerCase() : firstArg
            const argumentStart = explicitSource ? 3 : 2
            const monitorKey = `${chat_id}:${sourceId}`
            const monitorState = videoMonitors.get(monitorKey)
            const sourceLabel = sourceId === '1' ? '外接摄像头' : '原摄像头'
            if (subcommand === 'start') {
              if (monitorState?.running) {
                responseTitle = '视频监控已经在运行'
                responseContent = `${sourceLabel}当前已有持续监控任务。发送 vid ${sourceId} stop 停止，vid ${sourceId} show 查看资源统计。`
              } else {
                const device = parts.slice(argumentStart).join(' ').trim() || undefined
                const state = { running: true, chatId: chat_id, senderOpenId, sourceId }
                videoMonitors.set(monitorKey, state)
                runVideoMonitor(chat_id, senderOpenId, device, sourceId).catch(error => {
                  console.error('[vid.monitor] unexpected error:', error?.stack || error)
                })
                responseTitle = '视频监控已启动'
                responseContent = `已开始监控${sourceLabel}：每轮采集 10 秒、每秒 1 帧并分析运动；检测到明显运动时会自动发送视频。发送 vid ${sourceId} stop 停止，vid ${sourceId} show 查看资源统计。`
              }
            } else if (subcommand === 'stop') {
              if (monitorState?.running) {
                monitorState.running = false
                responseTitle = '视频监控正在停止'
                responseContent = `${sourceLabel}当前这段 10 秒采集和分析完成后就会停止，不会再开始下一轮。`
              } else {
                responseTitle = '视频监控当前未运行'
                responseContent = `如需开始，请发送 vid ${sourceId} start。`
              }
            } else if (subcommand === 'show') {
              const monitorStatus = monitorState?.running ? '开启' : monitorState ? '停止中' : '关闭'
              const stats = videoStatsByChat.get(monitorKey)
              if (!stats) {
                responseTitle = '暂无视频统计'
                responseContent = `摄像头：${sourceLabel}\n持续监控状态：${monitorStatus}\n还没有完成过监控视频采集。先发送 vid ${sourceId} start，完成第一轮后再发送 vid ${sourceId} show。`
              } else {
                const mib = value => (value / 1024 / 1024).toFixed(2) + ' MiB'
                let diskSpaceLine = '分区剩余空间：暂时无法读取'
                try {
                  const volume = path.parse(stats.path).root
                  const disk = fs.statfsSync(volume)
                  const freeBytes = Number(disk.bavail) * Number(disk.bsize)
                  diskSpaceLine = `分区剩余空间（${volume}）：${mib(freeBytes)}（${freeBytes.toLocaleString()} bytes）`
                } catch (diskError) {
                  console.warn('[vid.show] 读取分区剩余空间失败:', diskError?.message || diskError)
                }
                responseTitle = `${sourceLabel}最近一次视频资源统计`
                responseContent = [
                  `摄像头：${sourceLabel}`,
                  `持续监控状态：${monitorStatus}`,
                  `视频文件：${path.basename(stats.path)}`,
                  `磁盘占用：${mib(stats.sizeBytes)}（${stats.sizeBytes.toLocaleString()} bytes）`,
                  diskSpaceLine,
                  `机器人进程峰值内存：${mib(stats.memoryPeakBytes)}`,
                  `采集期间内存增量：${mib(stats.memoryDeltaBytes)}`,
                  `系统峰值内存占用：${mib(stats.systemMemoryPeakBytes)} / ${mib(stats.systemMemoryTotalBytes)}（${stats.systemMemoryPeakPercent}%）`,
                  `采集期间系统峰值 CPU：${stats.systemCpuPeak}%`,
                  `运动分数：${stats.motionScore}（阈值 ${MOTION_THRESHOLD}，${stats.moving ? '检测到运动' : '没有明显运动'}）`,
                  `统计时间：${new Date(stats.at).toLocaleString('zh-CN', { hour12: false })}`
                ].join('\n')
              }
            } else {
              const videoPath = sourceId === '1'
                ? await captureExternalVideo('vid-1')
                : await captureVideo(explicitSource ? (parts.slice(2).join(' ').trim() || undefined) : (parts.slice(1).join(' ').trim() || undefined))
              const upload = await client.im.v1.file.create({
                data: {
                  file_type: 'mp4',
                  file_name: path.basename(videoPath),
                  file: fs.createReadStream(videoPath),
                  duration: 10000
                }
              })
              videoFileKey = upload?.file_key || upload?.data?.file_key
              if (!videoFileKey) {
                const detail = [upload?.code != null ? `code=${upload.code}` : '', upload?.msg ? `msg=${upload.msg}` : '', `responseKeys=${Object.keys(upload || {}).join(',') || '(empty)'}`].filter(Boolean).join('; ')
                throw new Error(`飞书视频上传失败：没有返回 file_key。视频已保存在：${videoPath}`)
              }
              responseTitle = `${sourceLabel}视频`
              responseContent = `已录制并上传${sourceLabel}10 秒视频。本地文件：${videoPath}`
            }
          } else if (command === 'audio') {
            const senderOpenId = sender?.sender_id?.open_id
            if (!isCameraAuthorized(senderOpenId)) {
              throw new Error('audio 命令未授权。请先发送 otp <6位验证码> 完成授权，或配置 PHOTO_ALLOWED_OPEN_IDS。')
            }
            const sourceId = (parts[1] || '0').toLowerCase()
            if (!['0', '1'].includes(sourceId)) throw new Error('用法：audio [0|1] [本机麦克风设备名称]；0 为本机麦克风，1 为 RTSP 摄像头音频。')
            const device = sourceId === '0' ? parts.slice(2).join(' ').trim() || undefined : undefined
            const audioPath = await captureAudio(sourceId, device)
            try {
              const upload = await client.im.v1.file.create({
                data: { file_type: 'opus', file_name: path.basename(audioPath), file: fs.createReadStream(audioPath), duration: 10000 }
              })
              audioFileKey = upload?.file_key || upload?.data?.file_key
              if (!audioFileKey) throw new Error(`飞书音频上传失败：没有返回 file_key。`)
            } finally {
              try { fs.rmSync(audioPath, { force: true }) } catch (cleanupError) { console.warn('清理临时音频失败:', cleanupError?.message || cleanupError) }
            }
            responseTitle = '10 秒音频采集完成'
            responseContent = `已从${sourceId === '1' ? 'RTSP 摄像头' : '本机麦克风'}采集并上传 10 秒 Opus 音频。`
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
            const task = await startRunTask(prompt, chat_id, sender?.sender_id?.open_id, config, chat.model)
            responseTitle = '模型 Agent 任务已开启'
            responseContent = formatTask(task) + '\n\n可用 list 查看任务状态，id ' + task.id + ' 查看消息和工具调用历史。执行完毕后将直接发送结果。'
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
            taskForThread = task
            responseTitle = '任务详情'
            responseContent = formatTask(task, false)
            const detailRes = await createCardWithLogging('task-detail', {
              data: { type: 'card_json', data: JSON.stringify(taskDetailCard(task).card.data) }
            })
            card_id = (detailRes?.code === 0 && detailRes?.data?.card_id) ? detailRes.data.card_id : null
            if (card_id) responseContent = null
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
                  responseContent = `help 本帮助目录；\notp <6位验证码> 使用启动时标准输出打印的 OTP 授权当前飞书账号（5 分钟内有效，单次绑定）；\nphoto [摄像头名称] 拍摄当前摄像头画面（需先 OTP 授权或配置 PHOTO_ALLOWED_OPEN_IDS，并安装 FFmpeg）；\nvid 0 [start|stop|show] 使用原摄像头；vid 1 [start|stop|show] 使用 vault 中 RTSP_URL 配置的外接摄像头；不带编号时兼容原有 vid 命令；\naudio 0 [麦克风设备名称] 采集本机麦克风 10 秒音频；audio 1 采集 vault 中 RTSP_URL 的 10 秒音频（需先 OTP 授权或配置 PHOTO_ALLOWED_OPEN_IDS，并安装 FFmpeg）；\ncave 洞穴游戏；\nmodels 模型列表；\nmine 扫雷游戏；\nd [D:\\路径] 列举 D 盘目录；\ntask D:\\路径 :: 任务描述 派发 codex exec 任务；\nrun <任务描述> 使用当前模型和工具循环执行任务；\nlist [数量] 查询持久化任务状态；\nid <任务ID> 查询任务消息和工具调用历史；\nhistory [数量] 查询任务历史；\ntaskinfo <任务ID> 查询任务详情；`
                }
            }
          }
        } catch (e) {
          responseTitle = 'Agent 操作失败'
          responseContent = e.message
        }

        if (videoFileKey) {
          const videoRet = await client.im.v1.message.reply({
            path: { message_id },
            data: { msg_type: 'media', content: JSON.stringify({ file_key: videoFileKey, duration: 10000 }) }
          })
          const modu = chatState.get(chat_id)
          const new_message_id = videoRet?.data?.message_id
          if (typeof modu?.setMessageId === 'function') modu.setMessageId(new_message_id)
          return
        }

        if (audioFileKey) {
          const audioRet = await client.im.v1.message.reply({
            path: { message_id },
            data: { msg_type: 'audio', content: JSON.stringify({ file_key: audioFileKey, duration: 10000 }) }
          })
          const modu = chatState.get(chat_id)
          const new_message_id = audioRet?.data?.message_id
          if (typeof modu?.setMessageId === 'function') modu.setMessageId(new_message_id)
          return
        }

        if (photoImageKey) {
          const imageRet = await client.im.v1.message.reply({
            path: { message_id },
            data: { msg_type: 'image', content: JSON.stringify({ image_key: photoImageKey }) }
          })
          const modu = chatState.get(chat_id)
          const new_message_id = imageRet?.data?.message_id
          if (typeof modu?.setMessageId === 'function') modu.setMessageId(new_message_id)
          return
        }

        const cardContent = card_id
          ? JSON.stringify({ type: 'card', data: { card_id } })
          : Lark.messageCard.defaultCard({ title: responseTitle, content: responseContent })
        let ret
        if (taskForThread) {
          if (taskForThread.threadRootMessageId) {
            ret = await client.im.v1.message.reply({ path: { message_id }, data: { receive_id: chat_id, content: cardContent, msg_type: 'interactive' } })
            await queueTaskThreadSync(taskForThread.id)
          } else {
            ret = await client.im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chat_id, content: cardContent, msg_type: 'interactive' } })
            const new_message_id = ret?.data?.message_id
            if (new_message_id) {
              agentStore.updateTask(taskForThread.id, { threadRootMessageId: new_message_id, threadPublishedMessageIndex: 0 })
              await queueTaskThreadSync(taskForThread.id)
            }
          }
        } else {
          ret = await client.im.v1.message.reply({ path: { message_id }, data: { receive_id: chat_id, content: cardContent, msg_type: 'interactive' } })
        }
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
