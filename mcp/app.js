import { App } from '@modelcontextprotocol/ext-apps'
import { mountPreview } from '../preview/view.js'

const app = new App({ name: 'Synapse Canvas', version: '0.1.0' }, {}, { autoResize: false })
let view
const applyTheme = context => {
  if (context?.theme) {
    document.documentElement.dataset.theme = context.theme
    document.documentElement.style.colorScheme = context.theme
  }
}
app.onhostcontextchanged = applyTheme
app.ontoolresult = () => { if (view) void view.refresh() }

try {
  await app.connect()
  applyTheme(app.getHostContext())
  await app.sendSizeChanged({ height: 720 })
  view = mountPreview({
    async get(path) {
      const uri = path === '/api/snapshot' ? 'synapse://canvas/snapshot'
        : path.startsWith('/api/sessions/') ? `synapse://canvas/sessions/${path.slice('/api/sessions/'.length)}` : null
      if (!uri) throw new Error('不支持的读取操作')
      const result = await app.readServerResource({ uri })
      const resource = result.contents?.find(content => content.uri === uri && typeof content.text === 'string')
      if (!resource) throw new Error('宿主未返回可读取的画布数据')
      return JSON.parse(resource.text)
    },
    async sendHostMessage(text) {
      const result = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] })
      if (result.isError) throw new Error('宿主未接受引用消息')
    },
  })
} catch {
  document.querySelector('#notice').hidden = false
  document.querySelector('#notice').textContent = '画布未能连接 WorkBuddy 宿主，请重新打开 MCP 应用'
  document.querySelector('#sync').textContent = '连接失败'
}
