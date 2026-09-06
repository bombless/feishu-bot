const fs = require('fs')
const path = require('path')

class AgentStore {
  constructor (file = process.env.AGENT_HISTORY_FILE || path.join(__dirname, 'data', 'agent-history.json')) {
    this.file = path.resolve(file)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    this.data = this.load()
  }

  load () {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch (e) {
      return { tasks: [] }
    }
  }

  save () {
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  createTask ({ chatId, senderId, cwd, prompt }) {
    const now = new Date().toISOString()
    const task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatId: chatId || null,
      senderId: senderId || null,
      cwd,
      prompt,
      status: 'queued',
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      output: '',
      error: ''
    }
    this.data.tasks.unshift(task)
    this.save()
    return task
  }

  updateTask (id, patch) {
    const task = this.data.tasks.find(x => x.id === id)
    if (!task) return null
    Object.assign(task, patch)
    this.save()
    return task
  }

  listTasks (limit = 20) {
    return this.data.tasks.slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)))
  }

  getTask (id) {
    return this.data.tasks.find(x => x.id === id) || null
  }
}

module.exports = AgentStore
