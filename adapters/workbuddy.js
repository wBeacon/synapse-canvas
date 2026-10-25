import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { open, readdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { projectConversation, textContent } from '../core/conversation.js'

const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24)
const iso = value => Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value)).toISOString() : null

function userText(text, record) {
  // WorkBuddy 5.9.2 persists the runtime envelope in input_text. Only unwrap
  // the observed native envelope when structured provenance marks a new request.
  // A person quoting a similarly named XML tag must retain their own text.
  if (!/^\s*<system-reminder data-role="(?:user-context|additional-data)">/.test(text)) return text
  if (record.providerData?.startsNewUserRequest !== true) return null
  const envelope = /^(?:\s*<system-reminder data-role="(?:user-context|additional-data)">[\s\S]*?<\/system-reminder>)+\s*<user_query>([\s\S]*)<\/user_query>\s*$/.exec(text)
  return envelope ? envelope[1] : null
}

export function normalizeWorkBuddyRecords(records, sessionId) {
  const events = []
  let inherited = 0, unsupported = 0
  for (const [index, record] of records.entries()) {
    if (record.isSidechain === true) continue
    if (record.sessionId && record.sessionId !== sessionId) { inherited++; continue }
    const nativeId = typeof record.id === 'string' ? record.id : `line:${index}`
    const anchor = { provider: 'workbuddy', sessionId, messageId: nativeId }
    const base = { id: nativeId, anchor, at: iso(record.timestamp) }
    if (record.type === 'message' && ['user', 'assistant'].includes(record.role)) {
      const sourceKind = record.source?.kind ?? record.providerData?.source?.kind
      const injected = record.isMeta === true || record.isSidechain === true || record.isSynthetic === true
        || ['skill-catalog', 'runtime-context', 'system'].includes(sourceKind)
      const content = record.content ?? record.message?.content
      const body = textContent(Array.isArray(content) ? content.map(block =>
        ['input_text', 'output_text'].includes(block?.type) ? { ...block, type: 'text' } : block) : content)
      const text = record.role === 'user' ? userText(body, record) : body
      if (text === null) { unsupported++; continue }
      if (text.trim()) events.push({ ...base, kind: record.role, text, injected })
    } else if (['function_call', 'function_call_result'].includes(record.type)) {
      if (typeof record.callId !== 'string' || !record.callId) { unsupported++; continue }
      events.push({ ...base, kind: record.type === 'function_call' ? 'tool-call' : 'tool-result',
        callId: record.callId, name: record.name,
        failed: ['failed', 'error', 'cancelled'].includes(record.status) || record.output?.isError === true })
    } else if (['error', 'turn-error'].includes(record.type)) {
      events.push({ ...base, kind: 'error', text: '本轮执行失败，请在 WorkBuddy 查看详细原因' })
    } else if (!['session-meta', 'reasoning', 'file-history-snapshot', 'custom-title', 'ai-title'].includes(record.type)) {
      unsupported++
    }
  }
  return { events, inherited, unsupported }
}

async function readTranscript(path, root) {
  const actual = await realpath(path)
  if (!actual.startsWith(`${root}${sep}`)) throw new Error('历史路径超出 WorkBuddy 数据目录')
  const handle = await open(actual, 'r')
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > MAX_TRANSCRIPT_BYTES) throw new Error('历史文件过大，当前原型暂不加载')
    const buffer = Buffer.alloc(before.size)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    const lines = text.split('\n')
    const incomplete = lines.pop() !== ''
    const records = []
    let invalid = 0
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line)
        if (record && typeof record === 'object' && !Array.isArray(record)) records.push(record)
        else invalid++
      } catch { invalid++ }
    }
    return { records, invalid, incomplete, revision: `${before.mtimeMs}:${bytesRead}` }
  } finally { await handle.close() }
}

export class WorkBuddyReader {
  constructor({ home = join(homedir(), '.workbuddy'), account = null, marker = null } = {}) {
    if (!account && !marker) throw new Error('请用 --marker 限定测试会话，或用 --account 指定本地会话所属账号')
    if (marker !== null && (typeof marker !== 'string' || !marker.trim())) throw new Error('测试标记不能为空')
    this.home = resolve(home)
    this.account = account
    this.marker = marker
  }

  async snapshot() {
    const root = await realpath(this.home)
    const database = new DatabaseSync(join(root, 'workbuddy.db'), { readOnly: true, timeout: 1000 })
    let rows
    try {
      database.exec('PRAGMA query_only = ON')
      const columns = new Set(database.prepare('PRAGMA table_info(sessions)').all().map(column => column.name))
      for (const key of ['id', 'user_id', 'cwd', 'title', 'status', 'deleted_at', 'transport', 'updated_at']) {
        if (!columns.has(key)) throw new Error('WorkBuddy 会话索引结构发生变化，暂时无法读取')
      }
      const fields = ['id', 'user_id', 'cwd', 'title', 'status', 'updated_at',
        'custom_title', 'visibility', 'source_mode', 'is_background_automation']
        .map(key => columns.has(key) ? key : `NULL AS ${key}`).join(', ')
      const sql = `SELECT ${fields} FROM sessions WHERE deleted_at IS NULL AND transport = ?${this.account ? ' AND user_id = ?' : ''}`
      rows = database.prepare(sql).all(...(this.account ? ['local', this.account] : ['local']))
    } finally { database.close() }
    rows = rows.filter(row => (!this.account || row.user_id === this.account)
      && !['archived', 'hidden', 'deleted'].includes(String(row.status).toLowerCase())
      && !['archived', 'hidden'].includes(String(row.visibility).toLowerCase())
      && !row.is_background_automation
      && !['claw', 'assistant', 'cloud'].includes(String(row.source_mode).toLowerCase()))
    const index = new Map(rows.map(row => [row.id, row]))
    const candidates = new Map()
    const projects = join(root, 'projects')
    for (const directory of await readdir(projects, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue
      for (const file of await readdir(join(projects, directory.name), { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
        const id = file.name.slice(0, -6)
        if (!index.has(id)) continue
        if (candidates.has(id)) throw new Error('发现重复会话历史，暂时无法可靠选择')
        candidates.set(id, join(projects, directory.name, file.name))
      }
    }
    const sessions = [], accounts = new Set(), revisions = [], warnings = []
    for (const row of rows) {
      const path = candidates.get(row.id)
      if (!path) continue
      let log
      try { log = await readTranscript(path, root) } catch (error) {
        warnings.push(error.code === 'ENOENT' ? '一份历史已被移除，等待刷新' : '一份历史暂时无法读取')
        continue
      }
      const normalized = normalizeWorkBuddyRecords(log.records, row.id)
      if (this.marker && !normalized.events.some(event => event.kind === 'user' && !event.injected && event.text.includes(this.marker))) continue
      accounts.add(row.user_id)
      revisions.push([row.id, row.title, row.custom_title, row.status, row.cwd, log.revision])
      if (log.invalid) warnings.push('部分历史行无法解析，已跳过')
      if (log.incomplete) warnings.push('历史正在写入，未完成的行将在下次刷新读取')
      if (normalized.inherited) warnings.push('部分记录来自继承历史，当前只显示本会话记录，尚未连接跨会话分支')
      if (normalized.unsupported) warnings.push('部分事件格式尚未支持，请以 WorkBuddy 原生记录为准')
      sessions.push(projectConversation({
        id: `workbuddy:${digest(`${row.user_id}:${row.id}`)}`,
        source: { provider: 'workbuddy', sessionId: row.id },
        workspace: { id: digest(`${row.user_id}:${row.cwd}`), title: row.cwd?.split(/[\\/]/).filter(Boolean).pop() || '未指定工作区' },
        title: row.custom_title || row.title || '未命名会话',
        updatedAt: iso(row.updated_at), status: String(row.status), lineage: 'unverified',
      }, normalized.events))
    }
    if (accounts.size > 1) throw new Error('标记匹配了多个账号，请增加 --account 限定')
    sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.id.localeCompare(b.id))
    return { schemaVersion: 1, provider: 'workbuddy', mode: 'read-only',
      revision: digest(JSON.stringify([revisions.sort(), warnings])), sessions, warnings: [...new Set(warnings)] }
  }
}
