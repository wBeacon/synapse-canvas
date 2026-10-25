import { mountPreview } from '../preview/view.js'
import { demoSession, demoSnapshot } from './demo.js'

// A DOM marker lets manual host checks distinguish retention from remounting.
// It is ephemeral, carries no account data and is never sent anywhere.
document.documentElement.dataset.synapseInstance = crypto.randomUUID()
document.querySelector('.preview-source').textContent = '示例数据 · 未连接历史'
document.querySelector('.preview-footnote').textContent = '此页仅用于验证独立画布入口。数据为合成示例，不读取本机历史。'
mountPreview({
  sourceLabel: '合成示例 · 非聊天记录',
  async get(path) {
    if (path === '/api/snapshot') return demoSnapshot
    if (path === `/api/sessions/${encodeURIComponent(demoSession.id)}`) return { session: demoSession }
    throw new Error('示例记录不存在')
  },
})
