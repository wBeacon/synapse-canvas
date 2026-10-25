/** Platform-neutral, read-only projection. Native IDs are opaque anchors. */
export const READ_ONLY_CAPABILITIES = Object.freeze({
  readHistory: true, create: false, send: false, fork: false, archive: false, openNative: false,
})

export function textContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('\n')
}

export function projectConversation(session, events) {
  const turns = []
  const latest = new Map()
  const toolOwners = new Map()
  // An appended revision replaces its earlier value without changing its place.
  for (const event of events) if (event?.id) latest.set(event.id, event)
  let current = null
  for (const event of latest.values()) {
    if (event.injected === true) continue
    if (event.kind === 'user') {
      current = {
        id: `${session.id}:${event.id}`, anchor: event.anchor,
        question: event, answers: [], answer: null, tools: [], error: null,
      }
      turns.push(current)
    } else if (current !== null && event.kind === 'assistant') {
      current.answers.push(event)
      current.answer = event
    } else if (current !== null && event.kind === 'error') {
      current.error = event
    } else if (current !== null && ['tool-call', 'tool-result'].includes(event.kind)) {
      const owner = toolOwners.get(event.callId) ?? current
      let tool = owner.tools.find(item => item.id === event.callId)
      if (tool === undefined) {
        tool = { id: event.callId, name: event.name || '工具调用', status: 'pending', anchor: event.anchor }
        owner.tools.push(tool)
        toolOwners.set(event.callId, owner)
      }
      if (event.name) tool.name = event.name
      if (event.kind === 'tool-result') tool.status = event.failed ? 'failed' : 'done'
    }
  }
  return {
    ...session, capabilities: { ...READ_ONLY_CAPABILITIES, ...session.capabilities }, turns,
  }
}

/** Linear turn edges only; inter-session lineage requires a verified native anchor. */
export function layoutConversations(sessions) {
  const cards = [], edges = []
  for (const [row, session] of sessions.entries()) {
    for (const [column, turn] of session.turns.entries()) {
      const card = { id: turn.id, sessionId: session.id, turn, x: 48 + column * 365, y: 48 + row * 330 }
      cards.push(card)
      if (column > 0) edges.push({ from: session.turns[column - 1].id, to: turn.id })
    }
  }
  return { cards, edges }
}
