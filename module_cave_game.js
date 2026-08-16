const Chat = require('./chat')
const readline = require('readline')

const first_prompt = `
你两眼一睁，周围一片漆黑
你感觉懵懵懂懂的
逐渐适应了洞穴微弱的灯光
十分暗淡的光线似乎来自顶部方向，远远的地方似乎有微弱的火光
你试图回忆自己是怎么到这里的，但是什么都想不起来
你走过去，发现这里还有未熄灭的篝火
你大喊有没有人，但是没有任何回应，篝火旁什么都没有也没有其他人
你选择
1. 怎么有人升起篝火还没完全熄灭就走了，赶紧灭了
2. 这团火也许是救命的稻草，把旁边没用过的柴再加一点免得火灭了
`

const columnSetOptions = {
  tag: 'column_set',
  columns: [
    {
      tag: 'column',
      elements: [
        {
          tag: 'button',
          type: 'primary',
          text: {
            tag: 'plain_text',
            content: '选择1'
          },
          behaviors: [
            {
              type: 'callback',
              value: {
                action: 'cave',
                choice: '1'
              }
            }
          ]
        }
      ]
    },
    {
      tag: 'column',
      elements: [
        {
          tag: 'button',
          type: 'primary',
          text: {
            tag: 'plain_text',
            content: '选择2'
          },
          behaviors: [
            {
              type: 'callback',
              value: {
                action: 'cave',
                choice: '2'
              }
            }
          ]
        }
      ]
    }
  ]
}

const model = process.env.MODEL

class CaveGame {
  constructor (client, chat) {
    const system = `
你是一个洞穴探索文字游戏机器人
每次你要给用户两个选择，用户选择1或2之后你需要输出后面的场景以及对应的选择
        `

    chat = Object.assign(chat.clone(), {
      messages: [
        { role: 'system', content: system },
        { role: 'assistant', content: first_prompt }
      ]
    })

    this.api = chat
    this.client = client
    this.sequence = 0
    this.chat_id = undefined
    this.message_id = undefined
  }

  setMessageId (message_id) {
    this.message_id = message_id
  }

  async prompt (chat_id) {
    const client = this.client
    const config_card = {
      schema: '2.0',
      header: {
        title: {
          tag: 'plain_text',
          content: '洞穴游戏（' + this.api.model + '）'
        },
        template: 'blue',
        padding: '12px 8px 12px 8px'
      },
      body: {
        vertical_spacing: '0px',
        padding: '0px 0px 0px 0px',
        elements: [
          {
            tag: 'div',
            text: {
              content: first_prompt,
              tag: 'plain_text'
            }
          },
          columnSetOptions
        ]
      }
    }

    const res = await client.cardkit.v1.card.create({
      data: {
        type: 'card_json',
        data: JSON.stringify(config_card)
      }
    })
    console.log('client.cardkit.v1.card.create res', res)
    this.card_id = res.data.card_id

    console.log('return prompt()')
    return this.card_id
  }

  ask (p) {
    const api = this.api
    const reOptions = /\n你选择.*\n1\. ?(.+)\n2\. ?(.+)/
    const last_message = api.messages[api.messages.length - 1].content
    const match = last_message.match(reOptions)
    const options = {
      1: match[1],
      2: match[2]
    }
    let markdown =
      last_message.replace(reOptions, '') +
      `\n你选择：<font color='green'>${options[p]}</font>\n`
    const sq = ++this.sequence
    const md_id = 'md_' + +new Date()
    const config_stream_card = {
      schema: '2.0',
      header: {
        title: {
          tag: 'plain_text',
          content: '洞穴游戏（' + this.api.model + '）'
        },
        template: 'blue',
        padding: '12px 8px 12px 8px'
      },
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
          },
          columnSetOptions
        ]
      }
    }
    this.client.cardkit.v1.card
      .create({
        data: {
          type: 'card_json',
          data: JSON.stringify(config_stream_card)
        }
      })
      .then(async res => {
        const card_id = res.data.card_id
        const content = JSON.stringify({
          type: 'card',
          data: { card_id }
        })
        this.client.im.v1.message
          .reply({
            path: {
              message_id: this.message_id
            },
            data: {
              receive_id: this.chat_id,
              content,
              msg_type: 'interactive'
            }
          })
          .then(res => {
            // console.log('res', res)
            const message_id = res?.data?.message_id
            if (message_id) this.message_id = message_id
          })
        let reply = ''
        for await (const piece of api.ask(p)) {
          reply += piece.slice(1)

          this.client.cardkit.v1.cardElement.content({
            path: {
              element_id: md_id,
              card_id
            },
            data: {
              content: reply,
              sequence: ++this.sequence
            }
          })
        }
        const setting = await this.client.cardkit.v1.card.settings({
          path: {card_id},
          data: {
            settings:
              '{"config":{"streaming_mode":false}}',
            sequence: ++this.sequence
          }
        })
        console.log('setting', setting)
      })
    return {
      schema: '2.0',
      header: {
        title: {
          tag: 'plain_text',
          content: '洞穴游戏（' + this.api.model + '）'
        },
        template: 'blue',
        padding: '12px 8px 12px 8px'
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: markdown
          }
        ]
      }
    }
  }
}

module.exports = CaveGame
