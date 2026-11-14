'use strict'

const DEFAULT_JABLE_ORIGIN = 'https://jable.tv'

function normalizeCode (value) {
  return String(value || '').toUpperCase().replace(/[\\s_]+/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function extractMetadata (text) {
  const source = String(text || '')
  const codes = [...new Set((source.toUpperCase().match(/\\b[A-Z]{2,10}[-_ ]?\\d{2,6}\\b/g) || []).map(normalizeCode))]
  const lines = source.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean)
  return {
    codes,
    actor: (source.match(/(?:演员|女优|actress|出演者)\\s*[:：]?\\s*([^\\n,，|]+)/i) || [])[1]?.trim() || null,
    title: lines.slice(0, 8).join(' ').slice(0, 300) || (codes[0] || '未识别标题')
  }
}

function parseModelText (content) {
  const text = String(content || '').trim()
  const fenced = text.match(/```(?:json)?\\s*([\\s\\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  try {
    const parsed = JSON.parse(candidate)
    return { text: parsed.text || parsed.ocr_text || text, codes: Array.isArray(parsed.codes) ? parsed.codes.map(normalizeCode).filter(Boolean) : undefined, actor: parsed.actor || null, title: parsed.title || null }
  } catch { return { text } }
}

async function recognizeImage (image, options = {}) {
  const { apiUrl, apiKey, model, fetchImpl = fetch } = options
  if (!apiUrl || !apiKey || !model) throw new Error('找片 OCR 未配置：需要 URL、KEY 和支持图片输入的 MODEL。')
  const buffer = Buffer.isBuffer(image) ? image : Buffer.from(image)
  const mimeType = options.mimeType || 'image/jpeg'
  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model, stream: false, temperature: 0, messages: [{ role: 'user', content: [
      { type: 'text', text: '请识别图片中所有影片番号（如 SNOS-377、JUR-828）、演员姓名及标题文字。只返回 JSON：{"text":"识别到的原始文字","codes":["番号"],"actor":"演员名或空字符串","title":"标题或空字符串"}。不要猜测图片中没有出现的信息。' },
      { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + buffer.toString('base64') } }
    ] }] })
  })
  const body = await response.text()
  if (!response.ok) throw new Error('OCR 请求失败 (' + response.status + '): ' + body.slice(0, 500))
  let json
  try { json = JSON.parse(body) } catch { throw new Error('OCR 服务返回了无效 JSON。') }
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('OCR 服务没有返回识别结果。')
  return parseModelText(content)
}

function extractJableItems (html, origin = DEFAULT_JABLE_ORIGIN) {
  const items = []
  const seen = new Set()
  const anchorPattern = /<a\\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\\s\\S]*?)<\\/a>/gi
  for (const match of String(html || '').matchAll(anchorPattern)) {
    let url
    try { url = new URL(match[2], origin).href } catch { continue }
    if (!/\\/videos?\\//i.test(new URL(url).pathname) || seen.has(url)) continue
    const title = match[4].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&quot;/g, '"').replace(/\\s+/g, ' ').trim()
    if (!title) continue
    seen.add(url)
    items.push({ title, url })
  }
  return items
}

async function searchJable (query, options = {}) {
  const origin = (options.origin || DEFAULT_JABLE_ORIGIN).replace(/\\/+$/, '')
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl(origin + '/search/' + encodeURIComponent(query) + '/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeishuJableFinder/1.0)', Accept: 'text/html' },
    signal: options.signal
  })
  if (!response.ok) throw new Error('Jable 搜索失败 (' + response.status + ')')
  return extractJableItems(await response.text(), origin)
}

async function findByImage (image, options = {}) {
  const metadata = await (options.recognizeImage || recognizeImage)(image, options.ocr || options)
  const parsed = extractMetadata(metadata?.text || '')
  const codes = [...new Set([...(metadata?.codes || []), ...parsed.codes].map(normalizeCode).filter(Boolean))]
  const actor = metadata?.actor || parsed.actor
  const title = metadata?.title || parsed.title
  const queries = [...codes, ...(actor ? [actor] : [])]
  const search = options.searchJable || searchJable
  const candidates = []
  for (const query of queries) {
    const results = await search(query, options.jable || {})
    candidates.push(...results.map(item => ({ ...item, query })))
    const exact = candidates.find(item => codes.some(code => (item.title + ' ' + item.url).toUpperCase().includes(code)))
    if (exact) return { found: true, code: codes[0] || null, actor, title: exact.title, url: exact.url, candidates }
  }
  const unique = [...new Map(candidates.map(item => [item.url, item])).values()]
  if (unique.length) return { found: true, code: codes[0] || null, actor, title: unique[0].title, url: unique[0].url, candidates: unique }
  return { found: false, code: codes[0] || null, codes, actor, title: title || codes[0] || '未能识别影片标题', candidates: [] }
}

function formatResult (result) {
  if (result.found) return '找到 Jable 影片：\\n' + result.title + '\\n' + result.url + (result.code ? '\\n番号：' + result.code : '')
  const lines = ['Jable.tv 暂未找到匹配影片。', '标题/识别文字：' + (result.title || '未识别')]
  if (result.codes?.length) lines.push('番号：' + result.codes.join('、'))
  else if (result.code) lines.push('番号：' + result.code)
  if (result.actor) lines.push('演员：' + result.actor)
  return lines.join('\\n')
}

module.exports = { normalizeCode, extractMetadata, parseModelText, extractJableItems, recognizeImage, searchJable, findByImage, formatResult }
