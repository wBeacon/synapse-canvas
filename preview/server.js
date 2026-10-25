#!/usr/bin/env node
import { compactSession } from '../core/read-only-payload.js'
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { WorkBuddyReader } from '../adapters/workbuddy.js'

export function createPreviewServer({ reader, token = randomBytes(32).toString('hex') }) {
  const files = new Map([
    ['/', ['index.html', 'text/html']],
    ['/app.js', ['app.js', 'text/javascript']],
    ['/view.js', ['view.js', 'text/javascript']],
    ['/preview.css', ['preview.css', 'text/css']],
    ['/styles.css', ['../styles.css', 'text/css']],
    ['/core/conversation.js', ['../core/conversation.js', 'text/javascript']],
  ])
  let cached = null, pending = null, refreshedAt = 0
  const snapshot = () => {
    if (pending) return pending
    if (cached && Date.now() - refreshedAt < 1000) return Promise.resolve(cached)
    pending = reader.snapshot().then(value => { cached = value; refreshedAt = Date.now(); return value })
      .finally(() => { pending = null })
    return pending
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(body))
    }
    const port = server.address()?.port
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    if (!allowedHosts.includes(request.headers.host)) return send(403, { error: '不被信任的访问地址' })
    if (request.headers.origin && !allowedHosts.some(host => request.headers.origin === `http://${host}`)) return send(403, { error: '不被信任的来源' })
    if (request.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: '不允许跨站访问' })
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      return send(405, { error: '当前预览仅支持读取' })
    }
    try {
      const path = new URL(request.url, 'http://localhost').pathname
      if (path.startsWith('/api/')) {
        const provided = Buffer.from(request.headers.authorization ?? '')
        const expected = Buffer.from(`Bearer ${token}`)
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return send(401, { error: '请使用启动时提供的完整预览链接' })
        const data = await snapshot()
        if (path === '/api/snapshot') return send(200, { ...data, sessions: data.sessions.map(session => compactSession(session, 2000)) })
        const match = /^\/api\/sessions\/([^/]+)$/.exec(path)
        if (match) {
          const session = data.sessions.find(item => item.id === decodeURIComponent(match[1]))
          return session ? send(200, { session: compactSession(session, 200_000) }) : send(404, { error: '会话已移除或不在当前读取范围' })
        }
        return send(404, { error: '接口不存在' })
      }
      const file = files.get(path)
      if (!file) return send(404, { error: '页面不存在' })
      const contents = await readFile(new URL(file[0], import.meta.url))
      response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` })
      response.end(contents)
    } catch {
      // Error details may contain private paths or source records.
      send(503, { error: '读取暂时失败，请确认 WorkBuddy 数据目录和会话范围，然后重试' })
    }
  })
  return { server, token }
}

async function main() {
  const { values } = parseArgs({ options: {
    home: { type: 'string' }, account: { type: 'string' }, marker: { type: 'string' },
    port: { type: 'string', default: '4317' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('node preview/server.js --marker <测试标记> | --account <本地账号ID> [--home <数据目录>] [--port 4317]')
    return
  }
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口必须为 0 到 65535 的整数')
  const reader = new WorkBuddyReader(values)
  await reader.snapshot()
  const { server, token } = createPreviewServer({ reader })
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', accept)
  })
  console.log(`WorkBuddy 只读地图：http://127.0.0.1:${server.address().port}/#${token}`)
  const close = () => server.close(() => process.exit(0))
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('预览启动失败。请检查 --marker / --account、数据目录和端口；使用 --help 查看用法。'); process.exitCode = 1 })
}
