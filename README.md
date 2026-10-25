# Synapse Canvas

面向多 Harness 的可视化对话工作台，计划从 CodeBuddy / WorkBuddy 适配开始发展。

## 项目来源与致谢

本项目基于 [liangmianya/dsh-synapse](https://github.com/liangmianya/dsh-synapse) 开发，感谢原作者 liangmianya 的设计、实现与支持。

本项目的初始代码，包括对话地图与画布交互、DSH 会话接入与事件投影、布局存储、测试及相关文档，继承自 dsh-synapse。感谢原作者及上游贡献者完成这些基础工作，并感谢原作者支持 CodeBuddy / WorkBuddy 适配方向。

Synapse Canvas 是独立维护的衍生项目，保留上游提交历史和 MIT 许可证。原项目贡献归原作者及相应贡献者所有，后续开发与发布由本项目维护者负责。

导入基线：dsh-synapse `0.5.0`，提交 `265d7ff1f41c87e41f5648166e410cbf972c417f`。

详细来源与贡献边界见 [NOTICE](NOTICE)，原有版权与许可声明见 [LICENSE](LICENSE)。

## 当前状态

已保留上游 DSH 插件，并实现首版公共会话模型、WorkBuddy 本地历史只读地图和对话内 MCP App。

MCP App 可将问答引用发送到当前任务；向选定源会话追问、原生分叉、应用级常驻及 CodeBuddy 接入尚未完成。普通客户端账号的常驻 UI 接入方式仍待确认。

总体目标、能力边界、开发顺序和验收标准统一维护在[开发规划](docs/development-plan.md)。现有 npm 包配置仍使用上游名称 `dsh-synapse`，尚未进行独立包发布。

## 开发与验证

需要 Node.js `>=22.19.0` 和 pnpm；构建候选 Buddy 网页包时还需 Python 3。

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
python3 -m unittest discover -s tools -p 'test_*.py'
```

## WorkBuddy 本地只读地图

先在 WorkBuddy 创建一个首个问题含独立标记（例如 `MY_CANVAS_TEST`）的测试任务，再运行：

```sh
pnpm run preview:workbuddy -- --marker MY_CANVAS_TEST
```

打开终端输出的完整本地链接。页面支持搜索、工作区筛选、拖拽、缩放、详情和已保存记录刷新；访问令牌仅用于本机，不要分享或提交。按 `Ctrl+C` 结束服务。

也可使用 `--account '<本地账号ID>'` 明确限定账号，或通过 `--home`、`--port` 指定目录和端口。不会自动展示所有账号；标记匹配存在跨账号歧义时需要补充账号范围。

## WorkBuddy 对话内 MCP App

完成依赖安装与构建后，将 [MCP 配置示例](mcp/config.example.json)中的脚本路径改为本机绝对路径，并设置测试标记。GUI 找不到正确版本 Node 时，`command` 也使用绝对路径。

在 WorkBuddy「专家·技能·连接器 → 连接器 → 自定义连接器」中合并配置，保留其他服务，保存并信任、启用自己构建的 `synapse-canvas`。在独立测试任务中调用 `show_canvas`，画布出现后点击「激活 MCP App 以交互」。此路径无需启动 HTTP 预览服务。

更新代码后重新构建、禁用并启用该连接器，再调用工具，以刷新宿主缓存。引用按钮会直接向承载画布的当前任务发送新消息并触发回复。

该集成仅在对话内展示，尚无独立常驻入口。候选侧栏网页包可用 `pnpm run buddy:package` 构建到 `dist/`，只含合成数据，尚未安装到宿主。

## 上游文档

以下稳定文档继承自上游，描述 DSH 实现：

- [中文指南](docs/zh-CN/README.md)
- [English guide](docs/en/README.md)
- [DSH 架构与边界](docs/architecture.md)
- [DSH 开发与发布](docs/development.md)

## 许可证

[MIT](LICENSE)。保留原项目的版权与许可声明。
