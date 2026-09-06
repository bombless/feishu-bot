require('dotenv').config()
const Lark = require('@larksuiteoapi/node-sdk')
const CaveGame = require('./module_cave_game')
const Chat = require('./chat')
const MineGame = require('./module_mine_game')
const AgentStore = require('./agent_store')
const { createAgentServer, listDirectory, normalizeCwd } = require('./agent_server')

const chat = new Chat({
  url: process.env.URL,
  apiKey: process.env.KEY,
  model: process.env.MODEL,
  modelsUrl: process.env.MODELS_URL
})

const baseConfig = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET
}

const client = new Lark.Client(baseConfig)
const agentStore = new AgentStore()
createAgentServer({ store: agentStore })

const chatState = new Map()
const eventLog = new Map()

function formatTask (task) {
  const output = (task.output || task.error || '').trim()
  const tail = output ? `\n输出:\n${output.slice(-3000)}` : ''
  return `ID: ${task.id}\n状态: ${task.status}\n目录: ${task.cwd}\n任务: ${task.prompt}\n创建: ${task.createdAt}${task.startedAt ? `\n开始: ${task.startedAt}` : ''}${task.finishedAt ? `\n结束: ${task.finishedAt}` : ''}${task.exitCode !== null ? `\n退出码: ${task.exitCode}` : ''}${tail}`
}

function formatHistory (tasks) {
  if (!tasks.length) return '暂无任务历史。'
  return tasks.map((task, i) => `${i + 1}. ${task.id}\n   ${task.status} | ${task.cwd}\n   ${task.prompt.slice(0, 160)}`).join('\n')
}

async function replyText (messageId, chatId, title, content) {
  return client.im.v1.message.reply({
    path: { message_id: messageId },
    data: {
      receive_id: chatId,
      content: Lark.messageCard.defaultCard({ title, content }),
      msg_type: 'interactive'
    }
  })
}

const wsClient = new Lark.WSClient({
  ...baseConfig,
  loggerLevel: Lark.LoggerLevel.debug
})

wsClient.start({
  eventDispatcher: new Lark.EventDispatcher({}).register({
    'card.action.trigger': async data => {
      const {
        operator: { open_id },
        action: { value, form_value = {} },
        context: { open_chat_id }
      } = data
      console.log('Received card action:', data)
      if (value.action === 'set_model') {
        chat.model = value.model
        Object.values(value.meta).forEach(console.log)
        const meta = value.meta
        const markdown = '- ' + Object.keys(value.meta)
          .filter(x => meta[x] && !(meta[x] instanceof Object))
          .map(x => x + ': ' + meta[x])
          .join('\n- ')
        const card = {
          schema: '2.0',
          body: {
            elements: [
              { tag: 'div', text: { tag: 'plain_text', content: '模型被设置为' + value.model } },
              { tag: 'markdown', content: markdown }
            ]
          }
        }
        return { card: { data: card, type: 'raw' } }
      }
      if (value.action === 'mine_position') return chatState.get(open_chat_id).chat(value)
      if (value.action === 'cave') {
        const game = chatState.get(open_chat_id)
        const card = game.ask(value.choice)
        return { card: { data: card, type: 'raw' } }
      }
    },
    'im.message.receive_v1': async data => {
      const {
        event_id,
        message: { chat_id, content, create_time, message_id },
        sender
      } = data

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
        if (command === 'd' || command === 'ls' || command === 'dir') {
          const target = cmd.slice(command.length).trim() || 'D:\\'
          const result = listDirectory(target)
          responseTitle = 'D盘目录'
          responseContent = `${result.cwd}\n\n` + result.entries.map(x => `${x.type === 'directory' ? '[DIR]' : '[FILE]'} ${x.name}`).join('\n')
          if (!result.entries.length) responseContent += '(空目录)'
        } else if (command === 'task') {
          const match = cmd.match(/^task\s+(.+?)\s+([\s\S]+)$/i)
          if (!match) throw new Error('用法: task D:\\项目目录 任务描述')
          const cwd = normalizeCwd(match[1])
          const prompt = match[2].trim()
          if (!prompt) throw new Error('任务描述不能为空')
          const task = agentStore.createTask({
            chatId: chat_id,
            senderId: sender?.sender_id?.open_id,
            cwd,
            prompt
          })
          // 通过本地 Agent runner 执行；历史先落盘，所以即使进程中途退出也能看到任务已开启。
          require('./agent_server').runCodex
            ? require('./agent_server').runCodex(agentStore, task)
            : null
          responseTitle = '任务已开启'
          responseContent = formatTask(task) + '\n\n可用 history 查看历史。'
        } else if (command === 'history' || command === 'tasks') {
          const limit = parts[1] || 20
          responseTitle = 'Agent 任务历史'
          responseContent = formatHistory(agentStore.listTasks(limit))
        } else if (command === 'taskinfo') {
          const id = parts[1]
          if (!id) throw new Error('用法: taskinfo task-...')
          const task = agentStore.getTask(id)
          if (!task) throw new Error('找不到任务: ' + id)
          responseTitle = '任务详情'
          responseContent = formatTask(task)
        } else {
          switch (cmd) {
            case 'mine': {
              const mine_game = new MineGame(client, chat_id)
              chatState.set(chat_id, mine_game)
              card_id = await mine_game.prompt()
              break
            }
            case 'cave': {
              const cave_game = new CaveGame(client, chat.clone())
              chatState.set(chat_id, cave_game)
              card_id = await cave_game.prompt()
              break
            }
            default:
              if (cmd.startsWith('models')) {
                const search = cmd.startsWith('models ') ? cmd.slice('models '.length) : ''
                await chat.models(search).then(async ({ output: { models } }) => {
                  models = models.filter(x => x.features.includes('web-search')).filter(x => x.published_time > '2026-05-20')
                  models.sort((a, b) => a.published_time < b.published_time ? -1 : 0)
                  const elements = models.map(x => ({
                    tag: 'button', text: { tag: 'plain_text', content: x.name }, type: 'primary', width: 'default', size: 'medium',
                    behaviors: [{ type: 'callback', value: { action: 'set_model', model: x.model, meta: x } }]
                  }))
                  const config_models_card = { schema: '2.0', body: { elements } }
                  const res = await client.cardkit.v1.card.create({ data: { type: 'card_json', data: JSON.stringify(config_models_card) } })
                  card_id = res.data.card_id
                })
                responseTitle = '模型列表'
              } else {
                responseTitle = '帮助目录'
                responseContent = `
help 本帮助目录；
cave 洞穴游戏；
models 模型列表；
mine 扫雷游戏；
d [D:\\路径] 列举 D 盘目录；
task D:\\路径 任务描述 派发 codex exec 任务；
history [数量] 查询持久化任务历史；
taskinfo <任务ID> 查询任务详情；
`
              }
          }
        }
      } catch (e) {
        responseTitle = 'Agent 操作失败'
        responseContent = e.message
      }

      let cardContent
      if (card_id) {
        cardContent = JSON.stringify({ type: 'card', data: { card_id } })
      } else {
        cardContent = Lark.messageCard.defaultCard({ title: responseTitle, content: responseContent })
      }
      const ret = await client.im.v1.message.reply({
        path: { message_id },
        data: { receive_id: chat_id, content: cardContent, msg_type: 'interactive' }
      })
      const new_message_id = ret?.data?.message_id
      const modu = chatState.get(chat_id)
      if (typeof modu?.setMessageId === 'function') modu.setMessageId(new_message_id)
    }
  })
})

console.log('🤖 飞书机器人已启动（长连接模式）')
