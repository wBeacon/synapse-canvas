// DSH event interpretation, extracted from the upstream presentation/store module.
import { projectConversation } from '../core/conversation.js'
// The harness writes `user/message` rows of its own (runtime snapshots, skill
// catalogues). A canvas card must stand for a turn a person actually typed, so
// an injected row is recognised by its structured `source.kind` instead of by
// guessing at the prose (issue #31 / #23).
const INJECTED_USER_SOURCE_KINDS = new Set(['skill-catalog'])
// Stored projections keep no raw event to re-read, so the one-time cleanup
// recognises a legacy catalogue card by the markers only that injection emits:
// the `<system-reminder>` opener plus the `<available_skills>` index it wraps.
const SKILL_CATALOG_OPENER = '<system-reminder>'
const SKILL_CATALOG_MARKER = '<available_skills>'

/** Event → canvas message kind, or null when the event is not a message. */
export function eventKind(event) {
  switch (event?.type) {
    case 'user/message': return 'user'
    case 'assistant/message': return 'assistant'
    case 'todo/write': return 'todo'
    case 'turn/end': {
      const reason = event.data?.reason
      if (reason?.kind === 'error') return 'error'
      if (reason?.kind === 'cancelled' || reason?.kind === 'canceled' || reason?.kind === 'aborted') return 'error'
      return null
    }
    default:
      return /(?:error|failed|failure|cancel(?:led)?|abort)/i.test(event?.type ?? '') ? 'error' : null
  }
}

/**
 * Full body of one event. Shared by the projection (which stores a preview) and
 * the on-demand loader (which returns the whole text), so both read the same
 * fields instead of keeping two parsers in step.
 */
export function eventBody(event) {
  switch (event?.type) {
    case 'user/message': return contentText(event.data?.content)
    case 'assistant/message': return contentText(event.data?.message?.content)
    case 'todo/write': return Array.isArray(event.data?.todos) ? event.data.todos.map(todo => `[${todo.status}] ${todo.content}`).join('\n') : ''
    case 'turn/end': {
      const reason = event.data?.reason
      if (reason?.kind === 'error') return errorText(reason.error) ?? '本轮执行失败'
      return '本轮已取消'
    }
    default:
      return eventKind(event) === 'error' ? errorText(event.data?.error ?? event.data?.reason ?? event.data) ?? 'Harness 运行失败' : ''
  }
}

export function errorText(value) {
  if (typeof value === 'string') return value.trim() || null
  if (value === null || value === undefined || typeof value !== 'object') return null
  const name = typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : ''
  const code = typeof value.code === 'string' && value.code.trim() !== '' ? value.code.trim() : ''
  const message = typeof value.message === 'string' && value.message.trim() !== '' ? value.message.trim() : ''
  if (message !== '') return [name, code].filter(Boolean).concat(message).join(': ')
  return [name, code].filter(Boolean).join(': ') || null
}

export function isRuntimeContextText(text) {
  return typeof text === 'string' && text.trimStart().startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')
}

export function isRuntimeContextMessage(message) {
  return message?.kind === 'user' && isRuntimeContextText(message.text)
}

/** A harness-authored turn, identified by its structured provenance. */
export function isInjectedUserSource(source) {
  return typeof source?.kind === 'string' && INJECTED_USER_SOURCE_KINDS.has(source.kind)
}

/**
 * Recognises a stored skill catalogue. Only the harness emits both markers
 * together, so a person quoting one of them is still kept as a real turn.
 */
export function isSkillCatalogText(text) {
  if (typeof text !== 'string') return false
  const head = text.trimStart()
  return head.startsWith(SKILL_CATALOG_OPENER) && head.includes(SKILL_CATALOG_MARKER)
}

/**
 * Whether a stored message must stay out of the canvas graph: runtime
 * snapshots and skill catalogues were never a turn the user took.
 */
export function isInjectedUserMessage(message) {
  return message?.kind === 'user' && (isRuntimeContextMessage(message) || isSkillCatalogText(message.text))
}

export function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => {
    if (block?.type === 'text') return [block.text]
    if (block?.type === 'tool-call') return [block.name, block.arguments]
    if (block?.type === 'tool-result') return contentText(block.content)
    return []
  }).filter(value => typeof value === 'string' && value.trim() !== '').join('\n')
}

export function normalizeDshEvent(event, sessionId = null) {
  const kind = eventKind(event)
  const anchor = { provider: 'dsh', sessionId, messageId: String(event.seq), sequence: event.seq }
  const base = { id: String(event.seq), anchor, at: event.time }
  if (event.type === 'tool/call' || event.type === 'tool/result') {
    return { ...base, kind: event.type === 'tool/call' ? 'tool-call' : 'tool-result',
      callId: String(event.data?.callId ?? event.data?.message?.source?.callId ?? ''),
      name: event.data?.name, failed: errorText(event.data?.error) !== null }
  }
  if (kind === null) return null
  const text = eventBody(event)
  if (kind === 'user' && (isInjectedUserSource(event.data?.source) || isRuntimeContextText(text))) return null
  return { ...base, kind, text }
}

export function projectDshConversation(session, events) {
  return projectConversation({ id: `dsh:${session.id}`, title: session.title || 'DSH 会话',
    source: { provider: 'dsh', sessionId: session.id },
    workspace: { id: session.header?.cwd ?? '', title: session.header?.cwd ?? '未指定工作区' },
    lineage: 'native',
  }, events.filter(event => event.seq >= (session.inheritedEventCount ?? 0))
    .map(event => normalizeDshEvent(event, session.id)).filter(Boolean))
}
