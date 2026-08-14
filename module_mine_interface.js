class MineInterface {
    constructor() {
        this.type = 'chatgpt'

    }
    config_card(board, mine_field, success) {
        return config_card_chatgpt(board, mine_field, success)
    }
}

module.exports = MineInterface


const icon_untouched = 'img_v3_0214i_58821f55-1368-4c11-85dd-4e4f862ee32g'

const icon_empty = 'img_v3_0214i_6aa1c979-34cb-41c9-b2cc-fb725c8c9bcg'

const icon_cry = 'img_v3_0214i_0b572b71-7cd8-4919-bca3-9ed18cea938g'

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



function config_card_chatgpt (board, mine_field, success) {
    console.log('board', board)
    console.log('mine_field', mine_field)
  const elements = []

  // 顶部状态
  elements.push({
    tag: 'column_set',
    flex_mode: 'none',
    horizontal_spacing: 'small',
    columns: [
      {
        tag: 'column',
        width: 'weighted',
        vertical_align: 'center',
        elements: [
          {
            tag: 'markdown',
            content: `**💣 ${mine_field.flat().filter(Boolean).length}**`
          }
        ]
      },
      {
        tag: 'column',
        width: 'weighted',
        vertical_align: 'center',
        elements: [
          {
            tag: 'markdown',
            content: '**💥 扫雷**'
          }
        ]
      },
      {
        tag: 'column',
        width: 'weighted',
        vertical_align: 'center',
        elements: [
          {
            tag: 'markdown',
            content: `**🚩 ${board.flat().filter(x => x === 'f').length}**`
          }
        ]
      }
    ]
  })

  elements.push({
    tag: 'hr'
  })

  // 6 × 6 棋盘
  for (let i = 0; i < 6; i += 1) {
    const columns = []

    for (let j = 0; j < 6; j += 1) {
      const state = board[i][j]

      let imgKey = icon_untouched

      if (state === '-') {
        imgKey = icon_empty
      } else if (state === 'c') {
        imgKey = icon_cry
      } else if (numbers[state]) {
        imgKey = numbers[state]
      }

      const button = {
        tag: 'button',
        element_id: `mine_${i}_${j}`,
        type: 'default',
        size: 'small',
        width: 'default',
        behaviors: [
          {
            type: 'callback',
            value: {
              action: 'mine_position',
              position: [i, j]
            }
          }
        ]
      }

      // 未翻开、空白、数字、踩雷分别使用对应图片
      button.text = {
        tag: 'plain_text',
        content: state === 'c'
          ? '💥'
          : state === '-'
            ? ' '
            : state === '+'
              ? '■'
              : String(state)
      }

      columns.push({
        tag: 'column',
        width: 'weighted',
        vertical_align: 'center',
        elements: [button]
      })
    }

    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      horizontal_spacing: 'small',
      columns
    })
  }

  elements.push({
    tag: 'hr'
  })

  // 游戏状态
  let status = ''

  if (success === true) {
    status = '🎉 恭喜你，扫雷成功！'
  } else if (success === false) {
    status = '💥 游戏结束'
  }

  elements.push({
    tag: 'markdown',
    text_align: 'center',
    content: status
  })

  // 底部重新开始
  elements.push({
    tag: 'button',
    element_id: 'mine_restart',
    text: {
      tag: 'plain_text',
      content: '🔄 重新开始'
    },
    type: 'primary',
    width: 'default',
    size: 'medium',
    behaviors: [
      {
        type: 'callback',
        value: {
          action: 'mine_restart'
        }
      }
    ]
  })

  return {
    schema: '2.0',
    config: {
      width_mode: 'compact'
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '💣 扫雷'
      },
      subtitle: {
        tag: 'plain_text',
        content: '6 × 6 · 扫雷游戏'
      },
      template: 'blue'
    },
    body: {
      direction: 'vertical',
      padding: '12px',
      elements
    }
  }
}
