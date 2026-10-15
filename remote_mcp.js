const http = require('node:http')
const crypto = require('node:crypto')
const { exec } = require('node:child_process')
const keytar = require('keytar')

const ENDPOINT = 'https://bombless.duckdns.org/mcp'
const SERVICE = 'feishu-bot-mcp'
const ACCOUNT = 'oauth'
const REDIRECT_URI = 'http://127.0.0.1:43127/oauth/callback'

function base64url (value) { return Buffer.from(value).toString('base64url') }
function random (bytes = 32) { return crypto.randomBytes(bytes).toString('base64url') }
function openBrowser (url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try { exec([command, ...args].map(x => JSON.stringify(x)).join(' ')) } catch {}
}
async function jsonResponse (response) {
  const text = await response.text()
  let value
  try { value = JSON.parse(text) } catch {}
  if (!response.ok) throw new Error('MCP OAuth/HTTP ' + response.status + ': ' + (value?.error_description || value?.error || text.slice(0, 500)))
  return value || {}
}
async function getJson (url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  return jsonResponse(response)
}
function wellKnown (base, suffix) {
  const u = new URL(base)
  return u.origin + '/.well-known/' + suffix + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''))
}

class RemoteMcp {
  constructor () {
    this.connected = false
    this.tools = []
    this.accessToken = null
    this.refreshToken = null
    this.clientInfo = null
    this.sessionId = null
    this.requestId = 0
    this.pendingAuth = null
  }

  async connect () {
    if (this.pendingAuth) return this.pendingAuth
    this.pendingAuth = this._connect().finally(() => { this.pendingAuth = null })
    return this.pendingAuth
  }

  async _connect () {
    const saved = await keytar.getPassword(SERVICE, ACCOUNT)
    if (saved) {
      try {
        const tokens = JSON.parse(saved)
        this.accessToken = tokens.access_token
        this.refreshToken = tokens.refresh_token || null
        if (tokens.client_info) this.clientInfo = tokens.client_info
        await this._initialize()
        return { connected: true, tools: this.tools.length, reusedToken: true }
      } catch (error) {
        this.accessToken = null
        this.refreshToken = null
      }
    }

    const resourceMetaUrl = wellKnown(ENDPOINT, 'oauth-protected-resource')
    const resourceMeta = await getJson(resourceMetaUrl).catch(() => ({}))
    const authServer = resourceMeta.authorization_servers?.[0] || new URL(ENDPOINT).origin
    const authMeta = await getJson(wellKnown(authServer, 'oauth-authorization-server'))
      .catch(() => getJson(new URL('/.well-known/openid-configuration', authServer).toString()))
    if (!authMeta.authorization_endpoint || !authMeta.token_endpoint) throw new Error('OAuth 服务发现失败：缺少 authorization_endpoint/token_endpoint')
    let clientInfo = this.clientInfo
    if (!clientInfo) {
      if (!authMeta.registration_endpoint) throw new Error('OAuth 服务未提供动态客户端注册端点')
      clientInfo = await jsonResponse(await fetch(authMeta.registration_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_name: 'feishu-bot',
          redirect_uris: [REDIRECT_URI],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none'
        })
      }))
      if (!clientInfo.client_id) throw new Error('OAuth 动态注册未返回 client_id')
      this.clientInfo = clientInfo
    }

    const verifier = random(48)
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
    const state = random(24)
    const authorize = new URL(authMeta.authorization_endpoint)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('client_id', clientInfo.client_id)
    authorize.searchParams.set('redirect_uri', REDIRECT_URI)
    authorize.searchParams.set('code_challenge', challenge)
    authorize.searchParams.set('code_challenge_method', 'S256')
    authorize.searchParams.set('state', state)
    if (resourceMeta.resource) authorize.searchParams.set('resource', resourceMeta.resource)
    if (resourceMeta.scopes_supported?.length) authorize.searchParams.set('scope', resourceMeta.scopes_supported.join(' '))

    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { server.close(); reject(new Error('OAuth 授权超时（10 分钟）')) }, 10 * 60 * 1000)
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, REDIRECT_URI)
        if (url.pathname !== '/oauth/callback') { res.writeHead(404); return res.end('Not found') }
        if (url.searchParams.get('state') !== state) { res.writeHead(400); return res.end('Invalid OAuth state') }
        if (url.searchParams.get('error')) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('OAuth failed: ' + url.searchParams.get('error'))
          clearTimeout(timer); server.close()
          return reject(new Error('OAuth 授权失败：' + url.searchParams.get('error_description', url.searchParams.get('error'))))
        }
        const code = url.searchParams.get('code')
        if (!code) { res.writeHead(400); return res.end('Missing code') }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><meta charset="utf-8"><title>Feishu Bot MCP</title><p>授权完成，可以关闭此页面并返回飞书。</p>')
        clearTimeout(timer); server.close(); resolve(code)
      })
      server.on('error', error => { clearTimeout(timer); reject(error) })
      server.listen(43127, '127.0.0.1', () => {
        openBrowser(authorize.toString())
        console.log('[MCP] OAuth URL: ' + authorize.toString())
      })
    })

    const tokenResponse = await fetch(authMeta.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
        client_id: clientInfo.client_id, code_verifier: verifier
      })
    })
    const tokens = await jsonResponse(tokenResponse)
    if (!tokens.access_token) throw new Error('OAuth token 响应缺少 access_token')
    this.accessToken = tokens.access_token
    this.refreshToken = tokens.refresh_token || null
    await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify({ ...tokens, client_info: clientInfo }))
    await this._initialize()
    return { connected: true, tools: this.tools.length, reusedToken: false }
  }

  async _request (method, params = {}) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
        ...(this.sessionId ? { 'MCP-Session-Id': this.sessionId } : {})
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params })
    })
    if (response.status === 401) throw new Error('MCP OAuth token 已失效，请执行 mcp connect 重新授权')
    const sid = response.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid
    if (!response.ok) throw new Error('MCP 请求失败 ' + response.status + ': ' + (await response.text()).slice(0, 500))
    const text = await response.text()
    if (!text) return {}
    const dataLine = text.split('\n').find(line => line.startsWith('data:'))
    const payload = dataLine ? dataLine.slice(5).trim() : text
    let json
    try { json = JSON.parse(payload) } catch { throw new Error('无法解析 MCP 响应: ' + payload.slice(0, 300)) }
    if (json.error) throw new Error('MCP ' + json.error.code + ': ' + json.error.message)
    return json.result || {}
  }

  async _initialize () {
    await this._request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'feishu-bot', version: '1.0.0' } })
    await this._notify('notifications/initialized')
    const result = await this._request('tools/list')
    this.tools = (result.tools || []).map(tool => ({
      type: 'function',
      function: {
        name: 'mcp_' + tool.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
        description: '[远程 MCP] ' + (tool.description || tool.name),
        parameters: tool.inputSchema || { type: 'object', properties: {} }
      },
      _mcpName: tool.name
    }))
    this.connected = true
  }

  async _notify (method, params = {}) {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.accessToken, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26',
        ...(this.sessionId ? { 'MCP-Session-Id': this.sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method, params })
    })
  }

  async callTool (name, args) {
    if (!this.connected) throw new Error('远程 MCP 尚未连接')
    const tool = this.tools.find(item => item.function.name === name)
    if (!tool) throw new Error('未知 MCP 工具: ' + name)
    return this._request('tools/call', { name: tool._mcpName, arguments: args || {} })
  }

  async disconnect () {
    this.connected = false
    this.tools = []
    this.accessToken = null
    this.refreshToken = null
    this.sessionId = null
    await keytar.deletePassword(SERVICE, ACCOUNT).catch(() => {})
    return { connected: false }
  }

  status () { return { connected: this.connected, tools: this.tools.map(t => t.function.name) } }
}

module.exports = new RemoteMcp()
