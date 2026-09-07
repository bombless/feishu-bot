const readline = require('readline')
const AgentStore = require('./agent_store')
const { listDirectory, normalizeCwd, runCodex } = require('./agent_server')

const store = new AgentStore()

function printDirectory (result) {
  console.log(`当前目录: ${result.cwd}`)
  const directories = result.entries.filter(x => x.type === 'directory')
  const files = result.entries.filter(x => x.type !== 'directory')

  for (const entry of directories) console.log(`📁 ${entry.name}`)
  for (const entry of files) console.log(`📄 ${entry.name}`)
  if (!result.entries.length) console.log('（空目录）')
}

function formatTask (task) {
  const output = (task.output || task.error || '').trim()
  const tail = output ? `\n输出:\n${output.slice(-3000)}` : ''
  return `ID: ${task.id}\n状态: ${task.status}\n目录: ${task.cwd}\n任务: ${task.prompt}\n创建: ${task.createdAt}${task.startedAt ? `\n开始: ${task.startedAt}` : ''}${task.finishedAt ? `\n结束: ${task.finishedAt}` : ''}${task.exitCode !== null ? `\n退出码: ${task.exitCode}` : ''}${tail}`
}

function formatHistory (tasks) {
  if (!tasks.length) return '暂无任务历史。'
  return tasks.map((task, i) => `${i + 1}. ${task.id}\n   ${task.status} | ${task.cwd}\n   ${task.prompt.slice(0, 160)}`).join('\n')
}

function printHelp () {
  console.log(`可用命令：
  d [D:\\路径]                         列举目录
  ls [D:\\路径]                        d 的别名
  dir [D:\\路径]                       d 的别名
  task D:\\路径 :: 任务描述             派发 codex exec 任务
  history [数量]                        查看任务历史
  taskinfo <任务ID>                     查看任务详情
  help                                  显示帮助
  quit / exit                           退出`)
}

async function execute (line) {
  const cmd = line.trim()
  if (!cmd) return

  const parts = cmd.split(/\s+/)
  const command = parts[0].toLowerCase()

  switch (command) {
    case 'd':
    case 'ls':
    case 'dir': {
      const target = cmd.slice(command.length).trim() || 'D:\\'
      printDirectory(listDirectory(target))
      return
    }

    case 'task': {
      const raw = cmd.slice(command.length).trim()
      const separator = raw.indexOf('::')
      if (separator < 0) throw new Error('用法: task D:\\项目目录 :: 任务描述')
      const cwd = normalizeCwd(raw.slice(0, separator).trim())
      const prompt = raw.slice(separator + 2).trim()
      if (!prompt) throw new Error('任务描述不能为空')

      const task = store.createTask({ cwd, prompt })
      console.log(formatTask(task))
      runCodex(store, task)
      console.log(`\n已启动 Codex: ${task.id}`)
      return
    }

    case 'history':
    case 'tasks':
      console.log(formatHistory(store.listTasks(parts[1] || 20)))
      return

    case 'taskinfo': {
      const task = store.getTask(parts[1])
      if (!task) throw new Error(`找不到任务: ${parts[1] || ''}`)
      console.log(formatTask(task))
      return
    }

    case 'help':
      printHelp()
      return

    default:
      throw new Error(`未知命令: ${command}，输入 help 查看帮助`)
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
})

console.log('🧪 Agent CLI 已启动（无聊天功能）')
printHelp()
rl.prompt()

rl.on('line', async line => {
  if (['quit', 'exit'].includes(line.trim().toLowerCase())) {
    rl.close()
    return
  }

  try {
    await execute(line)
  } catch (e) {
    console.error(`❌ ${e.message}`)
  }
  rl.prompt()
})

rl.on('close', () => {
  console.log('bye')
  process.exit(0)
})
