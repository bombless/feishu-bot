const crypto = require('node:crypto')
const keytar = require('keytar')

const ENDPOINT = 'https://bombless.duckdns.org/mcp'
const SERVICE = 'feishu-bot-mcp'
const ACCOUNT = 'oauth'
const REDIRECT_URI = 'http://127.0.0.1:43127/oauth/callback'

function base64url (value) { return Buffer.from(value).toString('base64url') }
function random (bytes = 32) { return crypto.randomBytes(bytes).toString('base64url') }
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
    this.pendingAuthorization = null
    this.authMeta = null
    this.tools = []
    this.toolMap = new Map()
    this.accessToken = null
    this.refreshToken = null
    this.clientInfo = null
    this.sessionId = null
    this.requestId = 0
    this.pendingAuth = null
    this.authMeta = null
    this.pendingAuthorization = null
  }

  async restoreStoredSession () {
    const saved = await keytar.getPassword(SERVICE, ACCOUNT)
    if (!saved) return false
    const tokens = JSON.parse(saved)
    this.accessToken = tokens.access_token
    this.refreshToken = tokens.refresh_token || null
    this.clientInfo = tokens.client_info || null
    await this._initialize()
    return true
  }

  async connect () {
    if (this.connected) return { connected: true, tools: this.tools.length, reusedToken: true }
    const saved = await keytar.getPassword(SERVICE, ACCOUNT)
    if (saved) {
      try {
        const tokens = JSON.parse(saved)
        this.accessToken = tokens.access_token
        this.refreshToken = tokens.refresh_token || null
        this.clientInfo = tokens.client_info || null
        await this._initialize()
        return { connected: true, tools: this.tools.length, reusedToken: true }
      } catch (error) {
        this.accessToken = null
        this.refreshToken = null
      }
    }
    return this.startAuthorization()
  }

  async startAuthorization () {
    if (this.pendingAuthorization) return { pending: true, message: '授权已开始，请在飞书发送 mcp otp <六位数字>' }
    const resourceMeta = await getJson(wellKnown(ENDPOINT, 'oauth-protected-resource'))
    const authServer = resourceMeta.authorization_servers?.[0] || new URL(ENDPOINT).origin
    const authMeta = await getJson(wellKnown(authServer, 'oauth-authorization-server'))
      .catch(() => getJson(new URL('/.well-known/openid-configuration', authServer).toString()))
    if (!authMeta.authorization_endpoint || !authMeta.token_endpoint || !authMeta.registration_endpoint) {
      throw new Error('OAuth 服务发现失败：缺少 authorization/token/registration endpoint')
    }
    let clientInfo = this.clientInfo
    if (!clientInfo) {
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
    this.authMeta = authMeta
    this.pendingAuthorization = { clientInfo, verifier, challenge, state, redirectUri: REDIRECT_URI, createdAt: Date.now() }
    return { pending: true, message: '请在 5 分钟内发送：mcp otp <六位数字>', authorizationUrl: authorize.toString() }
  }

  async submitTotp (code) {
    if (!/^\\d{6}$/.test(String(code))) throw new Error('验证码必须是六位数字')
    const pending = this.pendingAuthorization
    if (!pending || !this.authMeta) throw new Error('没有待完成的授权，请先发送 mcp connect')
    if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
      this.pendingAuthorization = null
      throw new Error('授权已超时，请重新发送 mcp connect')
    }
    const approveUrl = new URL('/oauth/authorize/approve', new URL(this.authMeta.authorization_endpoint).origin)
    approveUrl.searchParams.set('client_id', pending.clientInfo.client_id)
    approveUrl.searchParams.set('redirect_uri', pending.redirectUri)
    approveUrl.searchParams.set('state', pending.state)
    approveUrl.searchParams.set('code_challenge', pending.challenge)
    const response = await fetch(approveUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
      body: new URLSearchParams({ totp: String(code) })
    })
    if (response.status !== 302 && response.status !== 303) {
      const body = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim()
      if (response.status === 401) throw new Error('验证码错误或已过期，请重新输入六位数字')
      throw new Error('OAuth 验证失败 (' + response.status + '): ' + body.slice(0, 300))
    }
    const location = response.headers.get('location')
    if (!location) throw new Error('OAuth 授权响应缺少 redirect Location')
    const callback = new URL(location, pending.redirectUri)
    if (callback.searchParams.get('state') !== pending.state) throw new Error('OAuth state 校验失败')
    const oauthError = callback.searchParams.get('error')
    if (oauthError) throw new Error('OAuth 授权失败：' + oauthError)
    const codeFromCallback = callback.searchParams.get('code')
    if (!codeFromCallback) throw new Error('OAuth 回调未返回 authorization code')
    const tokenResponse = await fetch(this.authMeta.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: codeFromCallback,
        redirect_uri: pending.redirectUri, client_id: pending.clientInfo.client_id,
        code_verifier: pending.verifier
      })
    })
    const tokens = await jsonResponse(tokenResponse)
    if (!tokens.access_token) throw new Error('OAuth token 响应缺少 access_token')
    this.accessToken = tokens.access_token
    this.refreshToken = tokens.refresh_token || null
    await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify({ ...tokens, client_info: pending.clientInfo }))
    this.pendingAuthorization = null
    await this._initialize()
    return { connected: true, tools: this.tools.length }
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
    this.toolMap = new Map()
    this.tools = (result.tools || []).map(tool => {
      const exposedName = 'mcp_' + tool.name.replace(/[^a-zA-Z0-9_-]/g, '_')
      this.toolMap.set(exposedName, tool.name)
      return {
        type: 'function',
        function: {
          name: exposedName,
          description: '[远程 MCP] ' + (tool.description || tool.name),
          parameters: tool.inputSchema || { type: 'object', properties: {} }
        }
      }
    })
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
    const remoteName = this.toolMap.get(name)
    if (!remoteName) throw new Error('未知 MCP 工具: ' + name)
    return this._request('tools/call', { name: remoteName, arguments: args || {} })
  }

  async disconnect () {
    this.connected = false
    this.tools = []
    this.toolMap.clear()
    this.accessToken = null
    this.refreshToken = null
    this.sessionId = null
    await keytar.deletePassword(SERVICE, ACCOUNT).catch(() => {})
    return { connected: false }
  }

  status () { return { connected: this.connected, tools: this.tools.map(t => t.function.name) } }
}

module.exports = new RemoteMcp()
