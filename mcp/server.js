#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema,
  ReadResourceRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { WorkBuddyReader } from '../adapters/workbuddy.js'
import { compactSession } from '../core/read-only-payload.js'

export const UI_URI = 'ui://synapse-canvas/map'
export const SNAPSHOT_URI = 'synapse://canvas/snapshot'
const MIME = 'text/html;profile=mcp-app'
const uiMeta = { ui: { resourceUri: UI_URI } }

export function createCanvasMcpServer({ reader, widgetHtml, now = Date.now, initialSessionIds = null }) {
  const server = new Server({ name: 'synapse-canvas', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } })
  let cached = null, pending = null, at = 0, pinnedIds = initialSessionIds ? new Set(initialSessionIds) : null
  const snapshot = () => {
    if (pending) return pending
    if (cached && now() - at < 1000) return Promise.resolve(cached)
    pending = reader.snapshot().then(data => {
      pinnedIds ??= new Set(data.sessions.map(session => session.id))
      cached = { ...data, sessions: data.sessions.filter(session => pinnedIds.has(session.id)) }
      at = now()
      return cached
    }).finally(() => { pending = null })
    return pending
  }
  const read = async () => {
    try { return await snapshot() } catch { throw new McpError(ErrorCode.InternalError, '当前范围的 WorkBuddy 历史暂时无法读取') }
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: 'show_canvas', title: 'Synapse Canvas 会话地图',
    description: '在应用内打开 Synapse Canvas 只读会话地图。仅展示服务启动时固定范围内的测试会话。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, _meta: uiMeta,
  }] }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (request.params.name !== 'show_canvas') throw new McpError(ErrorCode.InvalidParams, '未知工具')
    if (Object.keys(request.params.arguments ?? {}).length) throw new McpError(ErrorCode.InvalidParams, '此工具不接受参数，不能更改读取范围')
    const data = await read()
    return { content: [{ type: 'text', text: '已打开 Synapse Canvas 只读会话地图。' }],
      structuredContent: { sessionCount: data.sessions.length, turnCount: data.sessions.reduce((count, session) => count + session.turns.length, 0), readOnly: true },
      _meta: uiMeta }
  })
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [
    { uri: UI_URI, name: 'Synapse Canvas', mimeType: MIME },
    { uri: SNAPSHOT_URI, name: 'Scoped conversation snapshot', mimeType: 'application/json' },
  ] }))
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const uri = request.params.uri
    if (uri === UI_URI) {
      let text
      try { text = typeof widgetHtml === 'function' ? await widgetHtml() : widgetHtml }
      catch { throw new McpError(ErrorCode.InternalError, '画布组件尚未就绪，请先运行构建再重新打开应用') }
      return { contents: [{ uri, mimeType: MIME, text,
        _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } } }] }
    }
    const data = await read()
    let value
    if (uri === SNAPSHOT_URI) value = { ...data, sessions: data.sessions.map(session => compactSession(session, 2000)) }
    else if (uri.startsWith('synapse://canvas/sessions/')) {
      const id = uri.slice('synapse://canvas/sessions/'.length)
      let decoded
      try { decoded = decodeURIComponent(id) } catch { throw new McpError(ErrorCode.InvalidParams, '无效的会话标识') }
      const session = data.sessions.find(session => session.id === decoded)
      if (!session) throw new McpError(ErrorCode.InvalidParams, '会话不在当前读取范围')
      value = { session: compactSession(session, 200_000) }
    } else throw new McpError(ErrorCode.InvalidParams, '资源不存在')
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value) }] }
  })
  return server
}

async function main() {
  const { values } = parseArgs({ options: { home: { type: 'string' }, account: { type: 'string' }, marker: { type: 'string' } } })
  const reader = new WorkBuddyReader(values)
  const initial = await reader.snapshot()
  const widgetHtml = () => readFile(new URL('./widget.html', import.meta.url), 'utf8')
  const server = createCanvasMcpServer({ reader, widgetHtml, initialSessionIds: initial.sessions.map(session => session.id) })
  await server.connect(new StdioServerTransport())
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Synapse Canvas MCP 启动失败，请先构建 widget 并指定 --marker 或 --account'); process.exitCode = 1 })
}
