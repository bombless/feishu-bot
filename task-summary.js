// Generate a short task title with a separate, single-call Chat Completions request.
async function generateTaskSummary (config, prompt) {
  const fallback = fallbackSummary(prompt)
  if (!config?.url || !config?.apiKey || !config?.model || !prompt) return fallback
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(config.url, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model, stream: false,
        messages: [
          { role: 'system', content: '你是任务标题生成器。请将用户任务概括为准确、具体、易扫读的简体中文标题，建议 8-24 个汉字。只描述核心目标，不执行任务、不补充未提出的要求。必须调用 generate_task_summary 工具返回结果。' },
          { role: 'user', content: String(prompt).slice(0, 6000) }
        ],
        tools: [{ type: 'function', function: {
          name: 'generate_task_summary', description: '为当前任务生成一个简短标题',
          parameters: { type: 'object', properties: { summary: { type: 'string', description: '简洁的中文任务标题，不超过24个汉字为宜' } }, required: ['summary'], additionalProperties: false }
        } }],
        tool_choice: { type: 'function', function: { name: 'generate_task_summary' } }
      })
    })
    if (!response.ok) throw new Error(`summary request failed: HTTP ${response.status}`)
    const data = await response.json()
    const argsText = data?.choices?.[0]?.message?.tool_calls?.find(x => x?.function?.name === 'generate_task_summary')?.function?.arguments
    if (!argsText) throw new Error('summary tool call missing')
    const summary = JSON.parse(argsText).summary
    if (typeof summary !== 'string' || !summary.trim()) throw new Error('summary was empty')
    return Array.from(summary.trim().replace(/\s+/g, ' ')).slice(0, 36).join('')
  } catch (error) {
    console.warn('[task-summary] using fallback title:', error?.message || error)
    return fallback
  } finally { clearTimeout(timeout) }
}

function fallbackSummary (prompt) {
  const text = String(prompt || '').trim().replace(/\s+/g, ' ')
  if (!text) return '未命名任务'
  const chars = Array.from(text)
  return chars.length > 24 ? chars.slice(0, 24).join('') + '…' : text
}

function attachTaskSummary (store, task, config) {
  // Fire and forget so title generation never delays task execution.
  generateTaskSummary(config, task.prompt).then(summary => store.updateTask(task.id, { summary }))
    .catch(error => console.warn('[task-summary] failed:', error?.message || error))
}

module.exports = { generateTaskSummary, attachTaskSummary, fallbackSummary }