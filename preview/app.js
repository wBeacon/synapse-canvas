import { mountPreview } from './view.js'

let token = ''
function consumeToken() {
  if (location.hash) {
    token = location.hash.slice(1)
    try { sessionStorage.setItem('synapse-preview-token', token) } catch {}
    history.replaceState(null, '', location.pathname)
  } else {
    try { token = sessionStorage.getItem('synapse-preview-token') || '' } catch {}
  }
}
consumeToken()
mountPreview({
  async get(path) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || '读取失败')
    return body
  },
  onScopeChange(callback) {
    window.addEventListener('hashchange', () => { consumeToken(); callback() })
  },
})
