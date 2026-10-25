import assert from 'node:assert/strict'
import test from 'node:test'
import { projectConversation, layoutConversations } from '../core/conversation.js'
import { projectDshConversation } from '../adapters/dsh.js'
import { normalizeWorkBuddyRecords } from '../adapters/workbuddy.js'

const session = { id: 'workbuddy:test', source: { provider: 'workbuddy', sessionId: 'test' } }
const row = (id, role, text, extra = {}) => ({ id, type: 'message', role, sessionId: 'test',
  content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }], ...extra })

test('projects WorkBuddy text blocks into stable turns without leaking source envelopes', () => {
  const records = [row('q1', 'user', 'first'), row('a1', 'assistant', 'draft'), row('a2', 'assistant', 'final'),
    row('q2', 'user', 'second'), row('a3', 'assistant', 'next', { _meta: { private: 'SECRET' } })]
  const result = projectConversation(session, normalizeWorkBuddyRecords(records, 'test').events)
  assert.equal(result.turns.length, 2)
  assert.equal(result.turns[0].answer.text, 'final')
  assert.equal(result.turns[1].question.anchor.messageId, 'q2')
  assert.equal(result.capabilities.send, false)
  assert.equal(result.capabilities.fork, false)
  assert.ok(!JSON.stringify(result).includes('SECRET'))
  const graph = layoutConversations([result])
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.cards[1].x - graph.cards[0].x, 365)
})

test('keeps the latest revision at its original turn position and skips explicit injected messages', () => {
  const records = [row('meta', 'user', 'catalog', { isMeta: true }), row('q', 'user', 'question'),
    row('a', 'assistant', 'draft'), row('a', 'assistant', 'revised')]
  const result = projectConversation(session, normalizeWorkBuddyRecords(records, 'test').events)
  assert.equal(result.turns.length, 1)
  assert.equal(result.turns[0].answers.length, 1)
  assert.equal(result.turns[0].answer.text, 'revised')
})

test('unwraps native WorkBuddy context without exposing it or stripping user-quoted XML', () => {
  const wrapped = '<system-reminder data-role="user-context">PRIVATE_RUNTIME</system-reminder>\n'
    + '<system-reminder data-role="additional-data">PRIVATE_TIME</system-reminder>\n'
    + '<user_query>actual question with <user_query>quoted tags</user_query></user_query>'
  const normalized = normalizeWorkBuddyRecords([
    row('q1', 'user', wrapped, { providerData: { startsNewUserRequest: true } }),
    row('q2', 'user', '<user_query>literal quote</user_query>'),
    row('bad', 'user', '<system-reminder data-role="user-context">PRIVATE_UNFINISHED', { providerData: { startsNewUserRequest: true } }),
    row('ambiguous', 'user', wrapped),
  ], 'test')
  assert.equal(normalized.events[0].text, 'actual question with <user_query>quoted tags</user_query>')
  assert.equal(normalized.events[1].text, '<user_query>literal quote</user_query>')
  assert.equal(normalized.unsupported, 2)
  assert.ok(!JSON.stringify(normalized.events).includes('PRIVATE'))
})

test('pairs late tool results with the original turn instead of the next question', () => {
  const records = [row('q1', 'user', 'first'),
    { id: 'call', type: 'function_call', callId: 'c', name: 'read', arguments: 'SECRET' },
    row('q2', 'user', 'second'),
    { id: 'result', type: 'function_call_result', callId: 'c', status: 'failed', output: { content: 'SECRET' } }]
  const result = projectConversation(session, normalizeWorkBuddyRecords(records, 'test').events)
  assert.equal(result.turns[0].tools[0].status, 'failed')
  assert.equal(result.turns[1].tools.length, 0)
  assert.ok(!JSON.stringify(result).includes('SECRET'))
})

test('excludes inherited WorkBuddy records without guessing an inter-session fork', () => {
  const normalized = normalizeWorkBuddyRecords([row('parent', 'user', 'inherited', { sessionId: 'parent' }), row('own', 'user', 'own')], 'test')
  assert.equal(normalized.inherited, 1)
  assert.equal(projectConversation(session, normalized.events).turns.length, 1)
})

test('DSH reaches the same public model while keeping native sequence anchors and fork boundary', () => {
  const message = (seq, type, text) => ({ seq, type, time: 1, data: type === 'user/message'
    ? { content: [{ type: 'text', text }] } : { message: { content: [{ type: 'text', text }] } } })
  const projected = projectDshConversation({ id: 'native', inheritedEventCount: 2 }, [
    message(0, 'user/message', 'inherited'), message(1, 'assistant/message', 'old'),
    message(2, 'user/message', 'own'), message(3, 'assistant/message', 'answer'),
  ])
  assert.equal(projected.turns.length, 1)
  assert.equal(projected.turns[0].anchor.sequence, 2)
  assert.equal(projected.turns[0].answer.anchor.provider, 'dsh')
})
