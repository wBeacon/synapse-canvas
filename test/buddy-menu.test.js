import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBuddyPage } from '../buddy/build-page.js'
import { demoSnapshot } from '../buddy/demo.js'

test('menu package closes over declared local assets and retains upstream notices', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'synapse-menu-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const result = await buildBuddyPage(directory)
  const { pages } = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  assert.equal(pages.length, 1)
  for (const name of [pages[0].entry, ...pages[0].assets]) await readFile(join(directory, name))
  const html = await readFile(join(directory, pages[0].entry), 'utf8')
  for (const [, path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(path.startsWith('./'))
    assert.ok(pages[0].assets.includes(path.slice(2)))
  }
  assert.ok((await readFile(join(directory, 'NOTICE'), 'utf8')).includes('liangmianya/dsh-synapse'))
  assert.ok(result.inputs.every(path => !path.startsWith('adapters/') && !path.includes('node_modules/')))
})

test('menu demo contains only synthetic read-only data and cannot contact a history service', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'synapse-menu-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await buildBuddyPage(directory)
  const script = await readFile(join(directory, 'assets/app.js'), 'utf8')
  assert.ok(!/fetch\(|WebSocket|readServerResource|sendMessage|workbuddy\.db|\.jsonl|Bearer /.test(script))
  assert.ok(script.includes('示例数据 · 未连接历史'))
  assert.equal(demoSnapshot.sessions.length, 1)
  assert.equal(demoSnapshot.sessions[0].turns.length, 2)
  assert.equal(demoSnapshot.sessions[0].source.provider, 'demo')
  assert.ok(Object.values(demoSnapshot.sessions[0].capabilities).every(value => value === false))
})
