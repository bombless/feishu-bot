require('dotenv').config()
const Lark = require('@larksuiteoapi/node-sdk')
const CaveGame = require('./module_cave_game')
const Chat = require('./chat')
const MineGame = require('./module_mine_game')

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

const chatState = new Map()
const eventLog = new Map()

const wsClient = new Lark.WSClient({
  ...baseConfig,
  loggerLevel: Lark.LoggerLevel.debug
})

wsClient.start({
  // 处理「接收消息」事件，事件类型为 im.message.receive_v1
  eventDispatcher: new Lark.EventDispatcher({}).register({
    'card.action.trigger': async data => {
      const {
        operator: { open_id },
        action: { value, form_value = {} },
        context: { open_chat_id }
      } = data
      console.log('Received card action:', data)
      if (value.action === 'set_model') chat.model = value.model
      if (value.action === 'mine_position') {
        return chatState.get(open_chat_id).chat(value)
      }
      if (value.action === 'cave') {
        const game = chatState.get(open_chat_id)
        const card = game.ask(value.choice)
        console.log('card', card.body.elements[0].content)
        return {card: {data: card, type: 'raw'}}
      }
    },
    'im.message.receive_v1': async data => {
      const {
        event_id,
        message: { chat_id, content, create_time, message_id }
      } = data

      console.log('im.message.receive_v1', data)

      if (create_time + 10000 < +new Date()) {
        return // 时间太久远了
      }

      const msg = JSON.parse(content).text

      if (eventLog.has(event_id)) return
      eventLog.set(event_id, event_id)
      let responseTitle
      let responseContent
      let card_id
      let stream
      const md_id = 'md_1_' + +new Date()

      if (msg.trim() === '.quit') {
        chatState.delete(chat_id)
      }

      if (chatState.get(chat_id)) {
        console.log('???')
        try {
          const modu = chatState.get(chat_id)
          stream = modu.ask(msg)()
          responseTitle = '请选择'
          responseContent = ''

          console.log(md_id)
          const config_stream_card = {
            schema: '2.0',
            config: {
              streaming_mode: true,
              streaming_config: {
                print_frequency_ms: { default: 70 },
                print_step: { default: 1 },
                print_strategy: 'fast'
              }
            },
            body: {
              elements: [
                {
                  tag: 'markdown',
                  element_id: md_id
                }
              ]
            }
          }

          const res = await client.cardkit.v1.card.create({
            data: {
              type: 'card_json',
              data: JSON.stringify(config_stream_card)
            }
          })
          card_id = res.data.card_id
        } catch (e) {
          console.log('catch')
          responseTitle = '错误'
          responseContent = e.toString()
        }
      } else {
        const cmd = JSON.parse(content).text.trim()
        switch (cmd) {
          case 'mine':
            const mine_game = new MineGame(client, chat_id)
            console.log('mine_game got')
            chatState.set(chat_id, mine_game)
            card_id = await mine_game.prompt()
            console.log('got card_id', card_id)
            break
          case 'cave':
            const cave_game = new CaveGame(client, chat.clone())
            chatState.set(chat_id, cave_game)
            console.log('chatState.set cave_game')
            card_id = await cave_game.prompt()
            break
          default:
            if (cmd.startsWith('models')) {
              const search = cmd.startsWith('models ')
                ? cmd.slice('models '.length)
                : ''
              await chat.models(search).then(async ({ output: { models } }) => {
                models = models
                  .filter(x => x.features.includes('web-search'))
                  .filter(x => x.published_time > '2026-05-20')
                models.sort((a, b) =>
                  a.published_time < b.published_time ? -1 : 0
                )
                const elements = models.map(x => ({
                  tag: 'button',
                  text: {
                    tag: 'plain_text',
                    content: x.name
                  },
                  type: 'primary',
                  width: 'default',
                  size: 'medium',

                  behaviors: [
                    {
                      type: 'callback',
                      value: {
                        action: 'set_model',
                        model: x.model
                      }
                    }
                  ]
                }))

                const config_models_card = {
                  schema: '2.0',
                  body: {
                    elements
                  }
                }

                const res = await client.cardkit.v1.card.create({
                  data: {
                    type: 'card_json',
                    data: JSON.stringify(config_models_card)
                  }
                })
                card_id = res.data.card_id
              })
              responseTitle = '模型列表'
            } else {
              responseTitle = '帮助目录'
              responseContent = `
help 本帮助目录；
cave 洞穴游戏；
models 模型列表；
mine 扫雷游戏;
`
            }
            break
        }
      }

      console.log('card_id', card_id)
      // 示例操作：接收消息后，调用「发送消息」API 进行消息回复。
      let cardContent
      if (card_id) {
        cardContent = JSON.stringify({
          type: 'card',
          data: { card_id }
        })
      } else {
        cardContent = Lark.messageCard.defaultCard({
          title: responseTitle,
          content: responseContent
        })
      }
      console.log('card_id', card_id)
      const ret = await client.im.v1.message.reply({
        path: {
          message_id
        },
        data: {
          receive_id: chat_id,
          content: cardContent,
          msg_type: 'interactive'
        }
      })
      console.log('ret', ret)
      const new_message_id = ret?.data?.message_id;
      const modu = chatState.get(chat_id)
      if (typeof modu?.setMessageId === 'function') {
        modu.setMessageId(new_message_id)
      }

      if (stream) {
        console.log('开始stream')
        let sequence = 0
        for await (const piece of stream) {
          await client.cardkit.v1.cardElement.content({
            path: { card_id, element_id: md_id },
            data: {
              content: piece,
              sequence: ++sequence
            }
          })
        }
      }
    }
  })
})

console.log('🤖 飞书机器人已启动（长连接模式）')
