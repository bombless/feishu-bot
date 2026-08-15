class MineInterface {
  constructor () {
    this.type = 'chatgpt'
  }
  config_card (board, mine_field, success) {
    return config_card_chatgpt(board, mine_field, success)
  }
}

module.exports = MineInterface

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

  const columns = []

  // 6 × 6 棋盘
  for (let i = 0; i < 6; i += 1) {
    const column_elements = []

    for (let j = 0; j < 6; j += 1) {
      const state = board[i][j]

      const button = {
        tag: 'button',
        element_id: `mine_${i}_${j}`,
        type: 'default',
        size: 'small',
        width: 'default',
        padding: '0px 0px 0px 0px',
        horizontal_spacing: '0px',
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
        content:
          state === 'c'
            ? '💥'
            : state === '-'
            ? '   '
            : state === '+'
            ? '■'
            : ' ' + String(state) + ' '
      }

      column_elements.push(button)
    }

    columns.push({
      tag: 'column',
      width: '8px',
      vertical_align: 'center',
      padding: '0px',
      margin: '0px',
      horizontal_spacing: '0px',
      direction: 'horizontal',
      elements: column_elements
    })
  }
  elements.push({
    tag: 'column_set',
    flex_mode: 'none',
    horizontal_spacing: '0px',
    columns
  })

  elements.push({
    tag: 'hr'
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
      padding: '0px',
      vertical_spacing: '0px',
      elements
    }
  }
}
