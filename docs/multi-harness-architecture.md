# 首版公共模型与适配边界

## 当前依赖方向

```text
adapters/dsh.js ─────────→ index.js / DSH 原有存储与宿主
adapters/workbuddy.js ──→ preview/server.js → preview/app.js ┐
                    └──→ mcp/server.js → mcp/app.js        ├→ preview/view.js
                                                          ┘
core/conversation.js        公共事件 → 会话轮次 → 地图布局
core/read-only-payload.js   HTTP / MCP 共用的消息截断
```

`adapters/dsh.js` 从上游 `index.js` 提取事件解读、正文读取与注入消息识别。现有 DSH 存储通过它取得事件含义，接口、存储格式和原有前端保持兼容。
DSH 适配器同时提供 `projectDshConversation`，验证 DSH 与 WorkBuddy 能到达同一个公共轮次模型。
DSH 的完整存储和旧画布仍有平台专属逻辑，尚未完成整体迁移。

`adapters/workbuddy.js` 负责只读索引、范围筛选、JSONL 读取、原生文本块及上下文信封转换，随后交给公共投影函数。
`preview/view.js` 复用上游基础样式，通过传入的读取与宿主交互接口工作。HTTP 与 MCP 分别提供传输适配；视图不读取平台数据库、不解析原生日志，也不调用 DSH bridge。

## 公共模型

```js
{
  id: '平台内唯一的画布会话ID',
  source: { provider: 'workbuddy', sessionId: '原生会话ID' },
  workspace: { id: '工作区ID', title: '工作区名称' },
  title: '会话标题',
  capabilities: { readHistory: true, send: false, fork: false /* … */ },
  turns: [{
    id: '稳定轮次ID',
    anchor: { provider: 'workbuddy', sessionId: '原生会话ID', messageId: '原生问题ID' },
    question: { id: '原生问题ID', kind: 'user', text: '问题', anchor: { /* … */ } },
    answers: [/* 该轮保存的助手消息 */],
    answer: {/* 该轮最后一条助手消息 */},
    tools: [{ id: '原生callId', name: '工具名称', status: 'done' }],
    error: null,
  }],
}
```

公共层不要求消息 ID 为数字。DSH 锚点附带原生 `sequence`，WorkBuddy 锚点保留原生消息 ID；这些锚点只供已验证的平台适配器解释。
轮次顺序依据原生记录顺序，后续修订按同一个原生 ID 替换；工具调用按 callId 归属，迟到的结果仍回到原轮次。

当前布局只连接同一会话中相邻轮次。继承边界与原生 fork 操作属于适配器能力，尚未将未验证的 WorkBuddy 关系当作可靠分支。
DSH 原有画布继续保留原生 fork 行为。

## 数据与运行边界

公共模型只存在于内存中，没有新增会话数据库，也不直接修改 WorkBuddy 的历史存储。
只读预览的能力声明全部关闭会话写操作，服务端也拒绝写请求。
HTTP 列表使用短正文，详情按需读取更完整的消息；原生工具参数和推理正文未进入公共模型。

MCP App 嵌入已实际跑通。用户点击可将问答引用发送到承载画布的当前任务；它是宿主交互能力，与源会话的 `send` / `fork` 能力分开。当前源会话仍只读，详见[嵌入验证](workbuddy-embedding.md)。下一步继续验证指定源会话写操作与原生分叉，或单独接入 CodeBuddy。
