import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { WorkBuddyReader } from '../adapters/workbuddy.js'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'synapse-wb-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const directory = join(home, 'projects', 'example')
  await mkdir(directory, { recursive: true })
  const database = new DatabaseSync(join(home, 'workbuddy.db'))
  database.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT, cwd TEXT, title TEXT,
    status TEXT, updated_at INTEGER, deleted_at INTEGER, transport TEXT, visibility TEXT, source_mode TEXT)`)
  const add = async (id, overrides = {}) => {
    const row = { id, user_id: 'account-a', cwd: '/example', title: 'Test session', status: 'completed',
      updated_at: 1, deleted_at: null, transport: 'local', visibility: null, source_mode: 'craft', ...overrides }
    database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(row))
    const records = [
      { id: 'q', sessionId: id, type: 'message', role: 'user', content: [{ type: 'input_text', text: 'TEST_MARKER' }] },
      { id: 'a', sessionId: id, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
    ]
    await writeFile(join(directory, `${id}.jsonl`), records.map(row => JSON.stringify(row)).join('\n') + '\n')
  }
  t.after(() => database.close())
  return { home, directory, database, add }
}

test('requires an explicit scope instead of exposing every local account', () => {
  assert.throws(() => new WorkBuddyReader(), /--marker/)
  assert.throws(() => new WorkBuddyReader({ marker: ' ' }), /不能为空/)
})

test('filters deleted, archived, cloud, assistant and other-account sessions', async t => {
  const f = await fixture(t)
  await f.add('visible')
  await f.add('deleted', { deleted_at: 1 })
  await f.add('archived', { status: 'Archived' })
  await f.add('hidden', { visibility: 'hidden' })
  await f.add('cloud', { transport: 'cloud' })
  await f.add('assistant', { source_mode: 'claw' })
  await f.add('other', { user_id: 'account-b' })
  const result = await new WorkBuddyReader({ home: f.home, account: 'account-a' }).snapshot()
  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].source.sessionId, 'visible')
})

test('rejects an ambiguous marker across accounts', async t => {
  const f = await fixture(t)
  await f.add('first')
  await f.add('second', { user_id: 'account-b' })
  await assert.rejects(new WorkBuddyReader({ home: f.home, marker: 'TEST_MARKER' }).snapshot(), /多个账号/)
})

test('reads committed lines only, notices appends and leaves source bytes unchanged', async t => {
  const f = await fixture(t)
  await f.add('visible')
  const path = join(f.directory, 'visible.jsonl')
  const original = await readFile(path, 'utf8')
  const partial = JSON.stringify({ id: 'next', type: 'message', role: 'user', content: 'follow-up' })
  await writeFile(path, original + 'invalid\n' + partial)
  const beforeDatabase = await readFile(join(f.home, 'workbuddy.db'))
  const beforeLog = await readFile(path)
  const reader = new WorkBuddyReader({ home: f.home, marker: 'TEST_MARKER' })
  const first = await reader.snapshot()
  assert.equal(first.sessions[0].turns.length, 1)
  assert.equal(first.warnings.length, 2)
  assert.deepEqual(await readFile(path), beforeLog)
  assert.deepEqual(await readFile(join(f.home, 'workbuddy.db')), beforeDatabase)
  await writeFile(path, original + partial + '\n')
  const next = await reader.snapshot()
  assert.equal(next.sessions[0].turns.length, 2)
  assert.notEqual(next.revision, first.revision)
  f.database.prepare('UPDATE sessions SET deleted_at = 1 WHERE id = ?').run('visible')
  assert.equal((await reader.snapshot()).sessions.length, 0)
})

test('fails explicitly on an incompatible native schema', async t => {
  const f = await fixture(t)
  f.database.exec('DROP TABLE sessions; CREATE TABLE sessions (id TEXT)')
  await assert.rejects(new WorkBuddyReader({ home: f.home, account: 'account-a' }).snapshot(), /结构发生变化/)
})
