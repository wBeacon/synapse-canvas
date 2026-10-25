import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCanvasMcpServer, UI_URI, SNAPSHOT_URI } from '../mcp/server.js'
import { formatHostReference } from '../preview/view.js'

const widgetHtml = await readFile(new URL('../mcp/widget.html', import.meta.url), 'utf8')
const secretQuestion = 'SYNTHETIC_PRIVATE_QUESTION'

async function connect(t) {
  const session = { id: 'workbuddy:scoped', turns: [{ id: 'turn', question: { text: secretQuestion },
    answer: { text: 'answer' }, answers: [{ text: 'answer' }], tools: [] }] }
  const server = createCanvasMcpServer({ widgetHtml, reader: { snapshot: async () => ({
    revision: 'one', sessions: [session], warnings: [],
  }) } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'embedding-test', version: '0.1.0' })
  await client.connect(b)
  t.after(async () => { await client.close(); await server.close() })
  return client
}

test('advertises an MCP App while keeping conversation bodies out of tool results', async t => {
  const client = await connect(t)
  const { tools } = await client.listTools()
  assert.equal(tools.length, 1)
  assert.equal(tools[0]._meta.ui.resourceUri, UI_URI)
  assert.equal(tools[0].annotations.readOnlyHint, true)
  const result = await client.callTool({ name: 'show_canvas', arguments: {} })
  assert.equal(result._meta.ui.resourceUri, UI_URI)
  assert.equal(result.structuredContent.turnCount, 1)
  assert.ok(!JSON.stringify(result).includes(secretQuestion))
  const resource = await client.readResource({ uri: UI_URI })
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app')
  assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, [])
})

test('allows scoped resource reads but rejects attempts to widen the scope or write', async t => {
  const client = await connect(t)
  const snapshot = JSON.parse((await client.readResource({ uri: SNAPSHOT_URI })).contents[0].text)
  assert.equal(snapshot.sessions[0].turns[0].question.text, secretQuestion)
  const session = await client.readResource({ uri: 'synapse://canvas/sessions/workbuddy%3Ascoped' })
  assert.equal(JSON.parse(session.contents[0].text).session.turns.length, 1)
  await assert.rejects(client.readResource({ uri: 'synapse://canvas/sessions/outside' }), /当前读取范围/)
  await assert.rejects(client.callTool({ name: 'show_canvas', arguments: { account: 'another' } }), /不接受参数/)
  await assert.rejects(client.callTool({ name: 'send', arguments: {} }), /未知工具/)
})

test('ships a self-contained UI under the host prefetch limit, with dependency notices', () => {
  assert.ok(Buffer.byteLength(widgetHtml) < 256 * 1024)
  assert.ok(!/<script[^>]+src=|<link[^>]+stylesheet/.test(widgetHtml))
  const payload = /atob\('([^']+)'\)/.exec(widgetHtml)
  assert.ok(payload)
  const module = gunzipSync(Buffer.from(payload[1], 'base64')).toString()
  assert.ok(module.includes('synapse://canvas/snapshot'))
  assert.ok(!module.includes('Bearer '))
  assert.ok(widgetHtml.includes('Third-party notices'))
  assert.ok(widgetHtml.includes('@modelcontextprotocol/ext-apps'))
  assert.ok(widgetHtml.includes('liangmianya/dsh-synapse'))
})

test('pins the initial session set even if later sessions repeat the selection marker', async t => {
  let clock = 0
  let sessions = [{ id: 'initial', turns: [] }]
  const server = createCanvasMcpServer({ widgetHtml, now: () => clock,
    reader: { snapshot: async () => ({ revision: String(clock), sessions, warnings: [] }) } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'scope-test', version: '0.1.0' })
  await client.connect(b)
  t.after(async () => { await client.close(); await server.close() })
  assert.equal((await client.callTool({ name: 'show_canvas', arguments: {} })).structuredContent.sessionCount, 1)
  sessions = [...sessions, { id: 'later', turns: [] }]
  clock += 2000
  let result = JSON.parse((await client.readResource({ uri: SNAPSHOT_URI })).contents[0].text)
  assert.deepEqual(result.sessions.map(session => session.id), ['initial'])
  sessions = sessions.filter(session => session.id !== 'initial')
  clock += 2000
  result = JSON.parse((await client.readResource({ uri: SNAPSHOT_URI })).contents[0].text)
  assert.deepEqual(result.sessions, [])
})

test('bounds an explicitly sent host reference and labels truncated content', () => {
  const text = formatHostReference('t'.repeat(300), {
    question: { text: 'q'.repeat(200_000) }, answer: { text: 'a'.repeat(200_000) },
  })
  assert.ok(text.length < 13_000)
  assert.ok(text.includes('引用已截断'))
  assert.ok(text.startsWith('引用自 WorkBuddy 会话'))
})

test('reports missing widget assets without leaking a local filesystem path', async t => {
  const server = createCanvasMcpServer({ reader: { snapshot: async () => ({ sessions: [] }) },
    widgetHtml: async () => { throw new Error('ENOENT /private/local/path/widget.html') } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'missing-widget-test', version: '0.1.0' })
  await client.connect(b)
  t.after(async () => { await client.close(); await server.close() })
  await assert.rejects(client.readResource({ uri: UI_URI }), error =>
    error.message.includes('请先运行构建') && !error.message.includes('/private/'))
})
