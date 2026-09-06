const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

function normalizeCwd (input) {
  const requested = input || 'D:\\'
  const resolved = path.resolve(requested)
  const root = path.resolve('D:\\')
  const lower = resolved.toLowerCase()
  const rootLower = root.toLowerCase()
  if (lower !== rootLower && !lower.startsWith(rootLower + path.sep)) throw new Error('cwd 必须位于 Windows D: 盘内')
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error(`目录不存在: ${resolved}`)
  return resolved
}

function listDirectory (input) {
  const cwd = normalizeCwd(input)
  return {
    cwd,
    entries: fs.readdirSync(cwd, { withFileTypes: true }).map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
  }
}

function runCodex (store, task) {
  store.updateTask(task.id, { status: 'running', startedAt: new Date().toISOString() })
  const child = spawn(process.env.CODEX_BIN || 'codex', ['exec', task.prompt], {
    cwd: task.cwd,
    shell: false,
    windowsHide: true,
    env: process.env
  })
  let output = ''
  let error = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { error += chunk.toString() })
  child.on('error', err => store.updateTask(task.id, { status: 'failed', finishedAt: new Date().toISOString(), output, error: err.stack || String(err) }))
  child.on('close', code => store.updateTask(task.id, { status: code === 0 ? 'succeeded' : 'failed', finishedAt: new Date().toISOString(), exitCode: code, output, error }))
  return child
}

function createAgentServer ({ store, port = Number(process.env.AGENT_PORT || 8787), host = process.env.AGENT_HOST || '127.0.0.1' }) {
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  const readJson = req => new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(new Error('request too large')) })
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}) } catch { reject(new Error('invalid JSON')) } })
    req.on('error', reject)
  })

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || host}`)
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true })
      if (req.method === 'GET' && url.pathname === '/agent/list') return send(res, 200, listDirectory(url.searchParams.get('path') || 'D:\\'))
      if (req.method === 'GET' && url.pathname === '/agent/history') return send(res, 200, { tasks: store.listTasks(url.searchParams.get('limit')) })
      if (req.method === 'GET' && url.pathname.startsWith('/agent/tasks/')) {
        const task = store.getTask(decodeURIComponent(url.pathname.slice('/agent/tasks/'.length)))
        return task ? send(res, 200, task) : send(res, 404, { error: 'task not found' })
      }
      if (req.method === 'POST' && url.pathname === '/agent/task') {
        const body = await readJson(req)
        if (!body.prompt || typeof body.prompt !== 'string') return send(res, 400, { error: 'prompt required' })
        const cwd = normalizeCwd(body.cwd || 'D:\\')
        const task = store.createTask({ chatId: body.chatId, senderId: body.senderId, cwd, prompt: body.prompt })
        runCodex(store, task)
        return send(res, 202, task)
      }
      return send(res, 404, { error: 'not found' })
    } catch (e) {
      return send(res, 400, { error: e.message })
    }
  })
  server.listen(port, host, () => console.log(`🧠 Agent API: http://${host}:${port}`))
  return server
}

module.exports = { createAgentServer, listDirectory, normalizeCwd, runCodex }
