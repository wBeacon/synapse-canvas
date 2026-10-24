# Synapse Canvas

面向多 Harness 的可视化对话工作台，计划从 CodeBuddy / WorkBuddy 适配开始发展。

## 项目来源与致谢

本项目基于 [liangmianya/dsh-synapse](https://github.com/liangmianya/dsh-synapse) 开发，感谢原作者 liangmianya 的设计、实现与支持。

Synapse Canvas 是独立维护的衍生项目，保留上游提交历史和 MIT 许可证。原项目贡献归原作者及相应贡献者所有，后续开发与发布由本项目维护者负责。

导入基线：dsh-synapse `0.5.0`，提交 `265d7ff1f41c87e41f5648166e410cbf972c417f`。

## 当前状态

当前代码保留上游的 DSH 插件实现。公共核心解耦及 CodeBuddy / WorkBuddy 适配尚未完成；项目名称和规划不代表这些平台已获得支持。

现有包配置仍使用上游名称 `dsh-synapse`，独立包名和发布流程将在后续开发中调整。

## 开发

需要 Node.js `>= 22.19.0`。

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm test
```

## 文档

以下文档继承自上游，当前描述 DSH 实现：

- [中文指南](docs/zh-CN/README.md)
- [English guide](docs/en/README.md)
- [架构与边界](docs/architecture.md)
- [开发与发布](docs/development.md)

## 许可证

[MIT](LICENSE)。保留原项目的版权与许可声明。
