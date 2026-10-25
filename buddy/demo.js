import { projectConversation } from '../core/conversation.js'

// Synthetic fixture only. This entry must never import a local history reader.
export const demoSession = projectConversation({
  id: 'demo:menu-canvas', source: { provider: 'demo', sessionId: 'menu-canvas' },
  workspace: { id: 'demo', title: '合成示例' }, title: '画布入口验证示例',
  capabilities: { readHistory: false },
}, [
  { id: 'q1', kind: 'user', text: '这个画布用于验证什么？' },
  { id: 'a1', kind: 'assistant', text: '验证从 WorkBuddy 侧栏独立打开画布。这里全部是合成示例，不包含本机聊天记录。' },
  { id: 'q2', kind: 'user', text: '接下来如何检查常驻体验？' },
  { id: 'a2', kind: 'assistant', text: '安装后切换任务再返回，检查地图是否保留；重启客户端后再检查入口是否存在。当前还没有完成这些宿主验证。' },
])

export const demoSnapshot = { revision: 'buddy-menu-demo-v1', sessions: [demoSession], warnings: [] }
