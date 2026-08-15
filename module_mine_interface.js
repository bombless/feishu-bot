class MineInterface {
  constructor () {
    this.type = 'chatgpt'
    this.card_id = undefined
    this.sequence = 0
    this.element_id = 'master_content'
  }
  set_card_id (card_id) {
    this.card_id = card_id
  }
  config_card (board, mine_field) {
    return config_card_chatgpt(board, mine_field)
  }
  update_card (board, mine_field) {
    return card_content_chatgpt(board, mine_field)
  }
  button_element_id (i, j) {
    return button_element_id_chatgpt(i, j)
  }
  button_content (board, i, j) {
    return button_content_chatgpt(board, i, j)
  }
}

module.exports = MineInterface

function config_card_chatgpt (board, mine_field, id) {
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

  elements.push(card_content_chatgpt(board))

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

function button_content_chatgpt (board, i, j) {
  const state = board[i][j]
  return state === 'c'
    ? '💥'
    : state === '-'
    ? '   '
    : state === '+'
    ? '■'
    : ' ' + String(state) + ' '
}

function button_element_id_chatgpt (i, j) {
  return `mine_${i}_${j}`
}

function card_content_chatgpt (board) {
  const columns = []

  // 6 × 6 棋盘
  for (let i = 0; i < 6; i += 1) {
    const column_elements = []

    for (let j = 0; j < 6; j += 1) {
      const button = {
        tag: 'button',
        element_id: button_element_id_chatgpt(i, j),
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
        content: button_content_chatgpt(board, i, j)
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
  return {
    tag: 'column_set',
    element_id: this.element_id,
    flex_mode: 'none',
    horizontal_spacing: '0px',
    columns
  }
}
