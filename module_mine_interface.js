class MineInterface {
    constructor() {
        this.type = 'chatgpt'

    }
    config_card(board, mine_field, success) {
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

  // 6 × 6 棋盘
  for (let i = 0; i < 6; i += 1) {
    const columns = []

    for (let j = 0; j < 6; j += 1) {
      const state = board[i][j]

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
