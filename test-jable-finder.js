'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCode, extractMetadata, parseModelText, extractJableItems, findByImage, formatResult } = require('./jable-finder')

test('normalizes and extracts multiple catalogue codes', () => {
  assert.equal(normalizeCode('snos 377'), 'SNOS-377')
  assert.deepEqual(extractMetadata('SNOS-377 SAIKA KAWAKITA\\nJUR-828 AYUMI RYOU').codes, ['SNOS-377', 'JUR-828'])
})
test('parses structured OCR model output', () => {
  assert.deepEqual(parseModelText('{"text":"SNOS-377","codes":["snos-377"],"actor":"Saika Kawakita"}'), { text: 'SNOS-377', codes: ['SNOS-377'], actor: 'Saika Kawakita', title: null })
})
test('extracts Jable video links from search HTML', () => {
  assert.deepEqual(extractJableItems('<a href="/videos/snos-377-example/"><span>SNOS-377 Example</span></a>'), [{ title: 'SNOS-377 Example', url: 'https://jable.tv/videos/snos-377-example/' }])
})
test('returns exact match and URL without Feishu dependencies', async () => {
  const result = await findByImage(Buffer.from('fixture'), {
    recognizeImage: async () => ({ text: 'SNOS-377 SAIKA KAWAKITA', codes: ['SNOS-377'], actor: 'Saika Kawakita', title: 'SNOS-377' }),
    searchJable: async query => query === 'SNOS-377' ? [{ title: 'SNOS-377 Saika Kawakita', url: 'https://jable.tv/videos/snos-377/' }] : []
  })
  assert.equal(result.found, true)
  assert.equal(result.url, 'https://jable.tv/videos/snos-377/')
  assert.match(formatResult(result), /https:\\/\\/jable\\.tv\\/videos\\/snos-377\\//)
})
test('returns OCR title when Jable has no result', async () => {
  const result = await findByImage(Buffer.from('fixture'), {
    recognizeImage: async () => ({ text: 'JUR-828 AYUMI RYOU', codes: ['JUR-828'], actor: 'Ayumi Ryou', title: 'JUR-828 Ayumi Ryou' }),
    searchJable: async () => []
  })
  assert.equal(result.found, false)
  assert.equal(result.code, 'JUR-828')
  assert.match(formatResult(result), /JUR-828/)
})
