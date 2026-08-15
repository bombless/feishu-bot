require('dotenv').config()
const Lark = require('@larksuiteoapi/node-sdk')
const CaveGame = require('./module_cave_game')
const Chat = require('./chat')
const MineInterface = require('./module_mine_interface')

const chat = new Chat({
  url: process.env.URL,
  apiKey: process.env.KEY,
  model: process.env.MODEL,
  modelsUrl: process.env.MODELS_URL
})

const mine_interface = new MineInterface()

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

const icon_untouched = 'img_v3_0214i_58821f55-1368-4c11-85dd-4e4f862ee32g'
const icon_empty = 'img_v3_0214i_6aa1c979-34cb-41c9-b2cc-fb725c8c9bcg'

const icon_cry = 'img_v3_0214i_0b572b71-7cd8-4919-bca3-9ed18cea938g'

const icon_smile = 'img_v3_0214i_3e28e27d-6fe6-4a2a-8d1b-95ef664f737g'

const numbers = {
  1: 'img_v3_0214i_e32d51e2-23e5-4044-826e-705fa1ee5bcg',
  2: 'img_v3_0214i_fe9dfd0a-5441-4d11-abdc-c04e4e19729g',
  3: 'img_v3_0214i_e9876c40-9e2f-4c8b-9541-5c405231ed5g',
  4: 'img_v3_0214i_260a403c-2281-4b61-8529-8ed3f9b9e8dg',
  5: 'img_v3_0214i_2cb99f78-c7bb-48a6-8de6-7c71afef414g',
  6: 'img_v3_0214i_9c56d670-612a-4bf3-b43a-a8efbbc0128g',
  7: 'img_v3_0214i_de41e45a-dc95-415b-8e42-6a64702b456g',
  8: 'img_v3_0214i_607bd8f0-0449-4e20-98b0-8158f44b784g'
}

const board = []
function init_board () {
  for (let i = 0; i < 6; i += 1) {
    let line = []
    for (let j = 0; j < 6; j += 1) {
      line.push('+')
    }
    board[i] = line
  }
}
init_board()

const mine_field = []
function init_mine_field () {
  for (let i = 0; i < 6; i += 1) {
    let line = []
    for (let j = 0; j < 6; j += 1) {
      line.push(Math.random() < 0.15)
    }
    mine_field[i] = line
  }
}
init_mine_field()

async function updateBoard (open_id, i, j) {
  const old_card_id = mine_interface.card_id
  const old_element_id = mine_interface.button_element_id(i, j)
  mine_interface.sequence += 1
  const conentJson = JSON.stringify(mine_interface.button_content(board, i, j))
  const ret = await client.cardkit.v1.cardElement.update({
    path: { card_id: old_card_id, element_id: old_element_id },
    data: {
      element: conentJson,
      sequence: mine_interface.sequence
    }
  })
  console.log('update-------------------------------------', ret)
}

async function sendBoardCard (receive_id_type, receive_id) {

  const config_card = mine_interface.config_card(board, mine_field)

  const res = await client.cardkit.v1.card.create({
    data: {
      type: 'card_json',
      data: JSON.stringify(config_card)
    }
  })
  console.log(res)
  const card_id = res.data.card_id
  mine_interface.set_card_id(card_id)

  const success = check_success()
  const contentObject =
    success === true || success === false
      ? {
          text: success ? '胜利！' : '失败！'
        }
      : {
          type: 'card',
          data: { card_id }
        }

  const content = JSON.stringify(contentObject)

  await client.im.v1.message.create({
    params: { receive_id_type },
    data: {
      receive_id,
      content,
      msg_type: success === undefined ? 'interactive' : 'text'
    }
  })
}

function check_success () {
  let all_good = true
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 6; j += 1) {
      if (board[i][j] === 'c') return false
      if (board[i][j] === '+' && !mine_field[i][j]) {
        return undefined
      }
    }
  }
  return true
}

wsClient.start({
  // 处理「接收消息」事件，事件类型为 im.message.receive_v1
  eventDispatcher: new Lark.EventDispatcher({}).register({
    'im.chat.access_event.bot_p2p_chat_entered_v1': async data => {
      const {
        operator_id: { open_id }
      } = data
      await sendBoardCard('open_id', open_id)
    },
    'card.action.trigger': async data => {
      const {
        operator: { open_id },
        action: { value, form_value = {} }
      } = data
      console.log('Received card action:', data)
      if (value.action === 'set_model') chat.model = value.model
      if (value.action === 'mine_restart') {
        init_board()
        init_mine_field()
        return sendBoardCard('open_id', open_id)
      }
      if (value.action === 'mine_position') {
        const i = value?.position?.[0]
        const j = value?.position?.[1]

        const borad_state = board?.[i]?.[j]
        const mine_state = mine_field?.[i]?.[j]

        console.log('borad_state', borad_state)

        if (borad_state === '+') {
          if (mine_state === true) {
            board[i][j] = 'c'
          } else {
            let count = 0
            for (let x = i - 1; x <= i + 1; x += 1) {
              for (let y = j - 1; y <= j + 1; y += 1) {
                if (x < 0 || x >= 6 || y < 0 || y >= 6) continue
                if (mine_field[x][y]) count += 1
              }
            }
            board[i][j] = count ? count : '-'
          }
        }
        console.log('calling sendBoardCard', board)
        await updateBoard(open_id, i, j)
        console.log('called sendBoardCard')
      }
    },
    'im.message.receive_v1': async data => {
      const {
        event_id,
        message: { chat_id, content, create_time, message_id }
      } = data

      if (create_time + 10000 < +new Date()) {
        return // 时间太久远了
      }

      const msg = JSON.parse(content).text

      if (eventLog.has(event_id)) return
      eventLog.set(event_id, event_id)
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
          cardId = res.data.card_id
        } catch (e) {
          console.log('catch')
          responseTitle = '错误'
          responseContent = e.toString()
        }
      } else {
        const cmd = JSON.parse(content).text.trim()
        switch (cmd) {
          case 'h':
            await sendBoardCard('chat_id', chat_id)
            return
          case 'cave':
            const game = new CaveGame(chat.clone())
            chatState.set(chat_id, game)
            responseTitle = '洞穴游戏（' + chat.model + '）'
            responseContent = game.prompt()
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
                cardId = res.data.card_id
              })
              responseTitle = '模型列表'
            } else {
              responseTitle = '帮助目录'
              responseContent = `
help 本帮助目录；
cave 洞穴游戏；
models 模型列表；
`
            }
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
      await client.im.v1.message.reply({
        path: {
          message_id
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
