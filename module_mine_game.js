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

class MineGame {
  constructor (client, chat_id) {
    this.client = client
    this.chat_id = chat_id
    this.board = []
    this.mine_field = []
    init_board(this.board)
    init_field(this.mine_field)
  }

  async prompt () {
    const client = this.client
    const config_card = {
      schema: '2.0',
      header: {
        title: {
          tag: 'plain_text',
          content: '8×8扫雷游戏'
        },
        template: 'blue',
        padding: '12px 8px 12px 8px'
      },
      body: {
        vertical_spacing: '0px',
        padding: '0px 0px 0px 0px',
        elements: render_board(this.board)
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

  check_success () {
    const board = this.board
    let all_good = true
    for (let i = 0; i < 8; i += 1) {
      for (let j = 0; j < 8; j += 1) {
        if (board[i][j] === 'c') return false
        if (board[i][j] === '+' && !this.mine_field[i][j]) return undefined
      }
    }
    return true
  }

  reveal(i, j) {
        const borad_state = this.board?.[i]?.[j]
        const mine_state = this.mine_field?.[i]?.[j]
        
        let failed = false

        if (borad_state === '+') {
          if (mine_state === true) {
            failed = true
            this.board[i][j] = 'c'
          } else {
            let count = 0
            for (let x = i - 1; x <= i + 1; x += 1) {
              for (let y = j - 1; y <= j + 1; y += 1) {
                if (x < 0 || x >= 8 || y < 0 || y >= 8) continue
                if (this.mine_field[x][y]) count += 1
              }
            }
            this.board[i][j] = count ? count : '-'
            if (!count) {
                for (let x = -1; x <= 1; x += 1) {
                    for (let y = -1; y <= 1; y += 1) {
                        if (!x && !y) continue
                        this.reveal(i + x, j + y)
                    }
                }
            }
          }
        }
        return failed

  }

  chat(value) {
        const i = value?.position?.[0]
        const j = value?.position?.[1]


        let failed = this.reveal(i, j)
        let toast = undefined
        let template = 'blue'
        if (failed) {
          toast = { type: 'error', content: '失败了！' }
          template = 'red'
        } else if (this.check_success() === true) {
          toast = { type: 'success', content: '成功了！' }
          template = 'green'
        }
        return {
          toast,
          card: {
            type: 'raw',
            data: {
              schema: '2.0',
              header: {
                title: {
                  tag: 'plain_text',
                  content: '8×8扫雷游戏'
                },
                template,
                padding: '12px 8px 12px 8px'
              },
              body: {
                vertical_spacing: '0px',
                padding: '0px 0px 0px 0px',
                elements: render_board(this.board, toast)
              }
            }
          }
        }
    } 
}
module.exports = MineGame

function init_board (board) {
  for (let i = 0; i < 8; i += 1) {
    let line = []
    for (let j = 0; j < 8; j += 1) {
      line.push('+')
    }
    board[i] = line
  }
}

function init_field (mine_field) {
  for (let i = 0; i < 8; i += 1) {
    let line = []
    for (let j = 0; j < 8; j += 1) {
      line.push(Math.random() < 0.15)
    }
    mine_field[i] = line
  }
}

function render_line (line_number, line, disabled) {
  const ret = []

  for (let i = 0; i < line.length; i += 1) {
    let img_key
    switch (line[i]) {
      case '+':
        img_key = icon_untouched
        break
      case '-':
        img_key = icon_empty
        break
      case 'c':
        img_key = icon_cry
        break
      case 's':
        img_key = icon_smile
        break
      default:
        if (line[i] in numbers) {
          img_key = numbers[line[i]]
        }
    }

    ret.push({
      tag: 'interactive_container',
      width: '32px',
      height: '32px',
      padding: '0px 0px 0px 0px',
      disabled,
      behaviors: [
        {
          type: 'callback',
          value: {
            action: 'mine_position',
            position: [line_number, i]
          }
        }
      ],
      elements: [
        {
          tag: 'img',
          img_key,
          preview: false,
          mode: 'stretch',
          custom_width: 32
        }
      ]
    })
  }
  return ret
}

function render_board (board, disabled) {
  const ret = []
  for (let i = 0; i < board.length; i += 1) {
    ret.push({
      tag: 'interactive_container',
      direction: 'horizontal',
      padding: '0px 0px 0px 0px',
      horizontal_spacing: '0px',
      elements: render_line(i, board[i], !!disabled)
    })
  }
  return ret
}
