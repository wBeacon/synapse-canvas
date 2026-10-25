# WorkBuddy 首轮能力验证

验证日期：2026-10-25（Asia/Shanghai）。

环境：macOS，已安装并登录的 WorkBuddy 5.9.2 企业版；本轮仅验证本地开发任务。

## 结论

已验证本地会话索引和历史文件可读，可据此继续开发只读会话地图。
已通过原生界面完成两轮测试，并从同一份历史文件观察到新增问题与最终回复。
后续已完成 MCP App 嵌入与当前任务引用发送，见[详细验证](workbuddy-embedding.md)。向选定源会话直接追问、逐 token 流式订阅和原生分叉仍未验证。

## 实测能力

| 能力 | 结果 | 证据及边界 |
| --- | --- | --- |
| 检测安装版本 | 已验证 | 应用界面与 Info.plist 均为 5.9.2 |
| 读取本地会话索引 | 已验证 | 以 SQLite 只读模式读取 `~/.workbuddy/workbuddy.db` 的 `sessions` 表 |
| 定位本地历史 | 已验证 | `~/.workbuddy/projects/*/*.jsonl`；测试后 12 份历史均能通过文件名对应会话索引，包含已删除会话的残留记录 |
| 识别问答与工具事件 | 已验证格式 | 历史样本包含 `message`、`function_call`、`function_call_result`；`message.role` 区分用户与助手 |
| 原生界面新建与追问 | 已验证 | 创建独立测试任务，完成两轮纯文本问答 |
| 已落盘记录增量读取 | 已验证 | 0.5 秒轮询观察同一文件从 1 user / 1 assistant 变为 2 user / 1 assistant，再变为 2 user / 2 assistant |
| 已有会话列表和历史的稳定公开 API | 未验证 | 本轮实际读取的是本地存储，尚未建立第三方 API 连接 |
| 向选定源会话直接追问 | 未验证 | 当前任务的引用发送不等于指定源会话发送 |
| MCP App 向当前任务发送引用 | 已验证 | 合成测试问答作为新用户消息进入承载任务并触发回复；不是仅回填 |
| 逐 token 流式回复 | 未验证 | 只确认已写入文件的事件变化，未确认输出中间片段 |
| 指定回答处原生分叉 | 未验证 | 安装包代码存在会话 fork 相关实现；第三方可访问性及分叉位置参数未知 |
| MCP App 画布嵌入 | 已验证 | 原生任务内加载、搜索、缩放、详情与资源刷新成功 |
| 云端、助理及其他设备会话 | 未验证 | 本轮的本地开发任务不能代表这些会话类型 |

数据库同时保留部分已删除会话的索引和历史。未来正式适配器需要按当前账号、删除状态、归档状态和会话来源筛选；文件存在不代表会话应显示在活动地图中。

## 可复现实验

WorkBuddy 中保留了名为“Synapse Canvas 会话兼容性测试”的任务。
首轮用户消息带有人工标记 `SYNAPSE_CANVAS_PROBE_20261025`，要求仅输出 `SYNAPSE_PROBE_TURN_1_OK`；第二轮要求仅输出 `SYNAPSE_PROBE_TURN_2_OK`。
两次回复均已在历史中做精确文本比对，测试任务没有产生工具调用记录。

运行摘要探针：

```sh
python3 tools/workbuddy_probe.py \
  --marker SYNAPSE_CANVAS_PROBE_20261025 \
  --expect-reply SYNAPSE_PROBE_TURN_1_OK \
  --expect-reply SYNAPSE_PROBE_TURN_2_OK
```

预期核心结果：`selected_transcripts: 1`、`message_roles: {"assistant": 2, "user": 2}`、`expected_reply_match_counts: [1, 1]`。
任务被重命名不影响标记匹配；清除历史或继续发送包含相同回复的消息可能改变计数。

加上 `--watch-seconds 45` 可观察变化。探针只输出计数、事件类型及回复是否匹配，不输出标题、消息正文、工具参数、账号标识或会话 ID。
它不修改 WorkBuddy 数据，不提供网络服务，也不将历史内容保存到仓库。

探针使用 Python 标准库，是独立验证工具，尚未接入产品运行时。

```sh
python3 -m unittest discover -s tools -p 'test_workbuddy_probe.py'
```

## 接入入口调查

- 官方[连接器文档](https://open.workbuddy.cn/docs/connector)描述 MCP + Skill、CLI + Skill 扩展；扩展外部工具不等于取得全部原生会话控制权。
- 官方[Open API 文档](https://open.workbuddy.cn/docs/openapi)列出本地助理与云端任务接口，需要注册应用并完成 OAuth 授权。本轮未调用这些接口，不能将它们等同于本地开发任务接口。
- 官方[任务对话文档](https://www.codebuddy.cn/docs/workbuddy/Conversation)描述 MCP 应用界面展示；后续已通过实际嵌入验证。
- 安装包附带 Guest SDK，并包含 conversations/list、fork 等相关实现。这只是静态调查结果，尚未证明自定义扩展可调用，也不作为稳定公共协议。
- 包元信息声明 `wb` 命令，但本机 PATH 中未找到该命令，本轮未验证可运行的 `wb` CLI。

本地路径、字段和事件格式均属于当前版本的实现细节。需要版本检测、兼容性样本和失败时的明确提示；本轮不修改或复制安装包代码，也不借用应用凭证调用未公开服务。

## 下一步

更新：只读地图及首版公共模型已实现，见[使用说明](workbuddy-preview.md)与[适配边界](multi-harness-architecture.md)。[应用内嵌入](workbuddy-embedding.md)及当前任务引用发送也已验证。以下保留首轮推进顺序；后续重点是指定源会话的发送与原生分叉能力。

1. 在一个受限于当前账号和有效会话的只读原型中，将历史事件转换为平台无关的会话、轮次和工具记录；处理继承历史、重复记录和注入消息。
2. 用 DSH 与 WorkBuddy 的实际数据结构确定首版公共模型，保留原生 ID 及消息锚点，避免把 DSH 的事件序号直接套用到 WorkBuddy。
3. 单独验证第三方发送、原生分叉与界面承载方式，再决定完整适配路径。未验证操作保持不可用；无需等待这些操作即可推进只读地图。
