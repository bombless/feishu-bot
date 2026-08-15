class MineInterface {
  constructor () {
    this.type = 'chatgpt'
    this.card_id = undefined
    this.sequence = 0
    this.version_matrix = init_version_matrix()

  }
  set_card_id (card_id) {
    this.card_id = card_id
  }
  config_card (board, mine_field) {
    return config_card_chatgpt(board, mine_field, this.sequence)
  }
  update_card (board) {
    return card_content_chatgpt(board, this.sequence)
  }
  button_element_id (i, j) {
    return button_element_id_chatgpt(i, j, this.version_matrix[i][j])
  }
  button_content (board, i, j) {
    this.version_matrix[i][j] = this.sequence
    return button_content_chatgpt(board, i, j, this.sequence)
  }
}

module.exports = MineInterface

function init_version_matrix() {
  const ret = [];
  for (let i = 0; i < 6; i += 1) {
    const line = [];
    for (let j = 0; j < 6; j += 1) {
      line[j] = 0;
    }
    ret[i] = line
  }
  return ret;
}

function config_card_chatgpt (board, mine_field, seq) {
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

  elements.push(card_content_chatgpt(board, seq))

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

function button_content_chatgpt (board, i, j, seq) {
  const state = board[i][j]
  const content =
    state === 'c'
      ? '💥'
      : state === '-'
      ? '   '
      : state === '+'
      ? '■'
      : ' ' + String(state) + ' '
  if (seq) console.log('content is now', content)

  const button = {
    tag: 'button',
    element_id: button_element_id_chatgpt(i, j, seq),
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

  // console.log(button)

  // 未翻开、空白、数字、踩雷分别使用对应图片
  button.text = {
    tag: 'plain_text',
    content
  }
  return button
}

function button_element_id_chatgpt (i, j, seq) {
  return `mine_${i}_${j}_${seq}`
}

function card_content_chatgpt (board, seq) {
  const columns = []

  // 6 × 6 棋盘
  for (let i = 0; i < 6; i += 1) {
    const column_elements = []

    for (let j = 0; j < 6; j += 1) {
      const button = button_content_chatgpt(board, i, j, seq)
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
    flex_mode: 'none',
    horizontal_spacing: '0px',
    columns
  }
}
