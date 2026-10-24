import assert from 'node:assert/strict'
import test from 'node:test'
import { request } from 'node:http'
import { createPreviewServer } from '../preview/server.js'

test('serves only authenticated local read requests and never calls a mutation', async t => {
  let calls = 0
  const { server } = createPreviewServer({ token: 'test-token', reader: {
    snapshot: async () => { calls++; return { revision: 'one', sessions: [], warnings: [] } },
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const port = server.address().port
  const get = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers, method }, response => {
      let body = ''; response.on('data', chunk => { body += chunk }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
    }); req.on('error', reject); req.end()
  })
  const authorized = { Authorization: 'Bearer test-token' }
  assert.equal((await get('/api/snapshot')).status, 401)
  assert.equal((await get('/api/snapshot', authorized, 'POST')).status, 405)
  assert.equal((await get('/api/snapshot', { ...authorized, Host: `attacker.test:${port}` })).status, 403)
  assert.equal((await get('/api/snapshot', { ...authorized, Origin: 'https://attacker.test' })).status, 403)
  assert.equal((await get('/api/snapshot', { ...authorized, 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal(calls, 0)
  const result = await get('/api/snapshot', authorized)
  assert.equal(result.status, 200)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(calls, 1)
  assert.equal((await get('/api/sessions/outside-scope', authorized)).status, 404)
  assert.equal((await get('/../package.json')).status, 404)
  assert.equal((await get('/')).status, 200)
})

test('does not expose native paths or source records when reading fails', async t => {
  const { server } = createPreviewServer({ token: 'test-token', reader: {
    snapshot: async () => { throw new Error('/private/path SECRET') },
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/snapshot`, { headers: { Authorization: 'Bearer test-token' } })
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes('SECRET'))
})
