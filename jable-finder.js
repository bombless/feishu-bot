'use strict'
const ORIGIN = 'https://jable.tv'
function normalizeCode (value) { return String(value || '').toUpperCase().replace(/[\s_]/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') }
function extractMetadata (text) {
  const source = String(text || '')
  const matches = source.toUpperCase().match(/\b[A-Z]{2,10}[-_ ]\d{2,6}\b/g) || []
  const codes = Array.from(new Set(matches.map(normalizeCode)))
  return { codes, actor: null, title: source.trim().slice(0, 300) || codes[0] || '未识别标题' }
}
function parseModelText (content) {
  const text = String(content || '').trim()
  try {
    const value = JSON.parse(text)
    return { text: value.text || value.ocr_text || text, codes: Array.isArray(value.codes) ? value.codes.map(normalizeCode) : [], actor: value.actor || null, title: value.title || null }
  } catch (error) { return { text } }
}
async function recognizeImage (image, options) {
  options = options || {}
  if (!options.apiUrl || !options.apiKey || !options.model) throw new Error('找片 OCR 未配置：需要 URL、KEY 和支持图片输入的 MODEL。')
  const buffer = Buffer.isBuffer(image) ? image : Buffer.from(image)
  const mimeType = options.mimeType || (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png' : (buffer.toString('ascii', 0, 4) === 'RIFF' ? 'image/webp' : 'image/jpeg'))
  const response = await (options.fetchImpl || fetch)(options.apiUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + options.apiKey },
    body: JSON.stringify({ model: options.model, stream: false, temperature: 0, messages: [{ role: 'user', content: [
      { type: 'text', text: '识别图片中的影片番号、演员姓名、标题。只返回 JSON：{"text":"原始识别文字","codes":["番号"],"actor":"演员名","title":"标题"}。不要猜测。' },
      { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + buffer.toString('base64') } }
    ] }] })
  })
  const body = await response.text()
  if (!response.ok) throw new Error('OCR 请求失败 (' + response.status + '): ' + body.slice(0, 500))
  const json = JSON.parse(body)
  const message = json.choices && json.choices[0] && json.choices[0].message
  if (!message || typeof message.content !== 'string') throw new Error('OCR 服务没有返回识别结果。')
  return parseModelText(message.content)
}
function extractJableItems (html, origin) {
  origin = origin || ORIGIN
  const items = []
  const seen = new Set()
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)[\x3c]\/a>/gi
  for (const match of String(html || '').matchAll(re)) {
    let url
    try { url = new URL(match[1], origin).href } catch (error) { continue }
    if (new URL(url).pathname.indexOf('/videos/') < 0 || seen.has(url)) continue
    const title = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!title) continue
    seen.add(url)
    items.push({ title, url })
  }
  return items
}
async function searchJable (query, options) {
  options = options || {}
  const origin = (options.origin || ORIGIN).replace(/\/+$/, '')
  const response = await (options.fetchImpl || fetch)(origin + '/search/' + encodeURIComponent(query) + '/', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeishuJableFinder/1.0)', Accept: 'text/html' } })
  if (!response.ok) throw new Error('Jable 搜索失败 (' + response.status + ')')
  return extractJableItems(await response.text(), origin)
}
async function findByImage (image, options) {
  options = options || {}
  const metadata = await (options.recognizeImage || recognizeImage)(image, options.ocr || options)
  const parsed = extractMetadata(metadata.text || '')
  const codes = Array.from(new Set((metadata.codes || []).concat(parsed.codes).map(normalizeCode)))
  const actor = metadata.actor || parsed.actor
  const title = metadata.title || parsed.title
  const search = options.searchJable || searchJable
  const matches = []
  const candidates = []
  for (const code of codes) {
    const results = await search(code, options.jable || {})
    candidates.push.apply(candidates, results)
    const exact = results.find(item => (item.title + ' ' + item.url).toUpperCase().indexOf(code) >= 0)
    if (exact && !matches.some(item => item.code === code)) matches.push({ code, title: exact.title, url: exact.url })
  }
  if (matches.length) return { found: true, code: matches[0].code, actor, title: matches[0].title, url: matches[0].url, matches, candidates }
  if (candidates.length && !codes.length) return { found: true, code: null, actor, title: candidates[0].title, url: candidates[0].url, matches: candidates.map(item => ({ code: null, title: item.title, url: item.url })), candidates }
  return { found: false, code: codes[0] || null, codes, actor, title: title || codes[0] || '未能识别影片标题', matches: [], candidates: [] }
}
function formatResult (result) {
  if (result.found) {
    const matches = result.matches || [{ code: result.code, title: result.title, url: result.url }]
    return '找到 ' + matches.length + ' 条 Jable 影片：\n' + matches.map((item, index) => (index + 1) + '. ' + item.title + (item.code ? '（' + item.code + '）' : '') + '\n' + item.url).join('\n\n')
  }
  const lines = ['Jable.tv 暂未找到匹配影片。', '标题/识别文字：' + (result.title || '未识别')]
  if (result.codes && result.codes.length) lines.push('番号：' + result.codes.join('、'))
  else if (result.code) lines.push('番号：' + result.code)
  if (result.actor) lines.push('演员：' + result.actor)
  return lines.join('\n')
}
module.exports = { normalizeCode, extractMetadata, parseModelText, extractJableItems, recognizeImage, searchJable, findByImage, formatResult }
