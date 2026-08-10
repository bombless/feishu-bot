require('dotenv').config()
const Lark = require('@larksuiteoapi/node-sdk')
const CaveGame = require('./module_cave_game')

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
    'im.message.receive_v1': async data => {
      const {
        event_id,
        message: { chat_id, content }
      } = data

      const msg = JSON.parse(content).text

      if (eventLog.has(event_id)) return;
      eventLog.set(event_id, event_id);
      let responseTitle
      let responseContent
      let cardId
      let stream
      const md_id = 'md_1_' + +new Date()

      if (msg.trim() === '.quit') {
        chatState.delete(chat_id)
      }



      if (chatState.get(chat_id)) {
        try {
          const modu = chatState.get(chat_id)
          stream = modu.ask(msg)
          responseTitle = '请选择'
          responseContent = ''

          console.log(md_id)
          const config2 = {
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
              data: JSON.stringify(config2)
            }
          })
          console.log('res', res)
          cardId = res.data.card_id
        } catch (e) {
          console.log('catch')
          responseTitle = '错误'
          responseContent = e.toString()
        }
      } else {
        switch (JSON.parse(content).text.trim()) {
          case 'cave':
            const game = new CaveGame()
            chatState.set(chat_id, game)
            responseTitle = '洞穴游戏'
            responseContent = game.prompt()
            break
          default:
            responseTitle = '帮助目录'
            responseContent = `
help 本帮助目录；
cave 洞穴游戏；
`
            break
        }
      }

      console.log(responseContent)
      // 示例操作：接收消息后，调用「发送消息」API 进行消息回复。
      let cardContent
      if (cardId) {
        cardContent = JSON.stringify({
          type: 'card',
          data: { card_id: cardId }
        })
      } else {
        cardContent = Lark.messageCard.defaultCard({
          title: responseTitle,
          content: responseContent
        })
      }
      await client.im.v1.message.create({
        params: {
          receive_id_type: 'chat_id'
        },
        data: {
          receive_id: chat_id,
          content: cardContent,
          msg_type: 'interactive'
        }
      })
      if (stream) {
        console.log('开始stream')
        let sequence = 0
        for await (const piece of stream) {
          await client.cardkit.v1.cardElement.content({
            path: { card_id: cardId, element_id: md_id },
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
