require('dotenv').config()
const Lark = require('@larksuiteoapi/node-sdk')
const CaveGame = require('./module_cave_game')
const Chat = require('./chat')

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

const example = {
  schema: '2.0',
  body: {
    elements: []
  }
}

const images = [
  'img_v3_0214i_e32d51e2-23e5-4044-826e-705fa1ee5bcg',
  'img_v3_0214i_fe9dfd0a-5441-4d11-abdc-c04e4e19729g',
  'img_v3_0214i_e9876c40-9e2f-4c8b-9541-5c405231ed5g',
  'img_v3_0214i_260a403c-2281-4b61-8529-8ed3f9b9e8dg',
  'img_v3_0214i_2cb99f78-c7bb-48a6-8de6-7c71afef414g',
  'img_v3_0214i_9c56d670-612a-4bf3-b43a-a8efbbc0128g'
]
function flat () {
  const ret = []
  for (const img_key of images) {
    ret.push({
      tag: 'interactive_container',
      width: '48px',
      height: '48px',
      elements: [
        {
          tag: 'img',
          img_key,
          preview: false
        }
      ]
    })
  }
  return ret
}
async function sendDeepSeekCard (chat_id) {
  const config_models_card = {
    schema: '2.0',
    header: {
      title: {
        tag: 'plain_text',
        content: '6×6扫雷游戏'
      },
      template: 'blue',
      padding: '12px 8px 12px 8px'
    },
    body: {
      elements: [
        {
          tag: 'interactive_container',
          direction: 'horizontal',
          elements: [
            ...flat(),{
              tag: 'button',
              text: { tag: 'plain_text', content: '1' },
              icon: {
                tag: 'custom_icon',
                img_key: 'img_v3_0214i_9c56d670-612a-4bf3-b43a-a8efbbc0128g'
              }
            }
          ]
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '1' },
          icon: {
            tag: 'custom_icon',
            img_key: 'img_v3_0214i_9c56d670-612a-4bf3-b43a-a8efbbc0128g'
          }
        },
        {
          tag: 'select_img',
          name: 'select_img-1',
          layout: 'trisect',
          aspect_ratio: '1:1',
          disabled: false,
          disabled_tips: {
            tag: 'plain_text',
            content: '用户禁用提示文案'
          },
          options: [
            {
              img_key: 'img_v3_0214i_e32d51e2-23e5-4044-826e-705fa1ee5bcg',
              value: 'picture1',
              disabled: false,
              disabled_tips: {
                tag: 'plain_text',
                content: '用户禁用提示文案1'
              },
              hover_tips: {
                tag: 'plain_text',
                content: '第一张图'
              }
            },
            {
              img_key: 'img_v3_0214i_fe9dfd0a-5441-4d11-abdc-c04e4e19729g',
              value: 'picture2',
              disabled: false,
              disabled_tips: {
                tag: 'plain_text',
                content: '用户禁用提示文案2'
              },
              hover_tips: {
                tag: 'plain_text',
                content: '第二张图'
              }
            },
            {
              img_key: 'img_v3_0214i_e9876c40-9e2f-4c8b-9541-5c405231ed5g',
              value: 'picture3',
              disabled: false,
              disabled_tips: {
                tag: 'plain_text',
                content: '用户禁用提示文案3'
              },
              hover_tips: {
                tag: 'plain_text',
                content: '第三张图'
              }
            },
            {
              img_key: 'img_v3_0214i_260a403c-2281-4b61-8529-8ed3f9b9e8dg',
              value: 'picture4',
              disabled: false,
              disabled_tips: {
                tag: 'plain_text',
                content: '用户禁用提示文案4'
              },
              hover_tips: {
                tag: 'plain_text',
                content: '第四张图'
              }
            },
            {
              img_key: 'img_v3_0214i_2cb99f78-c7bb-48a6-8de6-7c71afef414g',
              value: 'picture5',
              disabled: false,
              disabled_tips: {
                tag: 'plain_text',
                content: '用户禁用提示文案5'
              },
              hover_tips: {
                tag: 'plain_text',
                content: '第五张图'
              }
            },
            {
              img_key: 'img_v3_0214i_9c56d670-612a-4bf3-b43a-a8efbbc0128g',
              value: 'picture6',
              disabled: false,
              disabled_tips: {
                tag: 'plain_text',
                content: '用户禁用提示文案6'
              },
              hover_tips: {
                tag: 'plain_text',
                content: '第六张图'
              }
            }
          ]
        },
        // 第1行
        {
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: '2px',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            }
          ]
        },
        // 第2行
        {
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: '2px',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            }
          ]
        },
        // 第3行
        {
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: '2px',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            }
          ]
        },
        // 第4行
        {
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: '2px',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            }
          ]
        },
        // 第5行
        {
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: '2px',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            }
          ]
        },
        // 第6行
        {
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_spacing: '2px',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',

                  type: 'default',
                  size: 'small',
                  width: 'fill',
                  text: { tag: 'plain_text', content: '' }
                }
              ]
            }
          ]
        },
        // 图片组件
        {
          tag: 'img',
          img_key: 'img_v3_0214i_412a0d2c-4322-484a-9b65-66ab8fbfb5eg',
          corner_radius: '8px',
          margin: '12px 0px 0px 0px'
        }
      ]
    }
  }

  const res = await client.cardkit.v1.card.create({
    data: {
      type: 'card_json',
      data: JSON.stringify(config_models_card)
    }
  })
  console.log(res)
  const card_id = res.data.card_id

  const content = JSON.stringify({
    type: 'card',
    data: { card_id }
  })

  await client.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chat_id,
      content,
      msg_type: 'interactive'
    }
  })

  // 辅助函数：生成格子按钮（实际编码时需展开）
  function gridButton (position, displayText) {
    return {
      tag: 'button',
      text: displayText,
      style: displayText === ' ' ? 'default' : 'primary', // 未点开为默认样式，已揭晓为强调色
      size: 'large',
      width: '100%',
      action: {
        type: 'callback',
        value: { action: 'reveal_cell', position: position }
      }
    }
  }
}

wsClient.start({
  // 处理「接收消息」事件，事件类型为 im.message.receive_v1
  eventDispatcher: new Lark.EventDispatcher({}).register({
    'im.chat.access_event.bot_p2p_chat_entered_v1': async data => {
      const {
        operator_id: { open_id }
      } = data
      await sendDeepSeekCard(open_id)
    },
    'card.action.trigger': async data => {
      const {
        operator: { open_id },
        action: { value, form_value = {} }
      } = data
      console.log('Received card action:', data)
      if (value.action === 'set_model') chat.model = value.model
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
            await sendDeepSeekCard(chat_id)
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
