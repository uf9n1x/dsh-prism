# Prism — 授权红队 / 渗透模式（DSH Desktop 插件）

> ⚠️ 仅用于**获得明确书面授权**的安全测试、红队评估、CTF 与漏洞赏金。作者不对未授权使用负责。

Prism 是 DSH Desktop 的一个自包含 bundle：注册 **「Prism 渗透模式」**，由**指挥官主 Agent**通过**事实—意图图**指挥**可替换工兵子代理**，事件驱动自动推进授权渗透任务，所有结论/证据/状态/交接持久化于 `.prism/`，可断点恢复。默认 Windows 本机运行，不依赖 Docker/Kali。

> 当前状态：**Phase 0（地基）**。本 README 为草案，P9 补齐并附验证证据。功能未实现前不可安装。

## 核心概念
- **指挥官（主 Agent）**：只读图/事实/证据/worker 状态，创建意图、派单、spawn/peek/msg/kill、写 hint、请求 verify；**不执行任何扫描/探测/利用命令**。
- **工兵（worker）**：独立 `prism-worker` 子代理，拿意图 + 依赖事实标题/摘要 + 按需证据，经 ExecutionBackend 执行，结果回图；上下文耗尽可按图谱接班。
- **事实—意图图**：事实是不可变节点，意图是工作单元（边）；`ready ⟺ 开放 ∧ from 事实全存在 ∧ 未待确认`。

## 安装（P9 后可用）
```powershell
# 开发态：本地 bundle 目录安装（绝对路径）
# 由 DSH 的 plugin_manager install_bundle 执行；安装后重启 dsh 生效
```
> 具体命令与验证结果在 P9 补充。

## 卸载
```powershell
# P9 补充：移除 bundle 后重启 dsh；普通会话不受影响
```

## Prism 模式 / 数据
- 新建会话选择「Prism 渗透模式」；普通标准/编码/PPT 会话不加载 Prism。
- 每个 engagement 在**会话工作目录**下用 `.prism/` 作为权威存储（一文件一节点，原子写，跨平台锁）。
- 迁移/恢复：把 `.prism/` 随项目目录一起带走；新会话在同一目录即可从图谱 + handover 恢复。

## Kali 配置（可选）
- 未配置 Kali 不影响本机模式与启动。
- P7 支持配置 transport（MCP / SSH）+ healthCheck；未联通将明确标注 **unverified**，绝不冒充可用。

## 未实现 / 未验证清单
- 见 `docs/ACCEPTANCE.md` 状态列；P9 汇总最终清单。

## 文档
- 规格：`docs/SPEC.md` · 决策：`docs/DECISIONS.md` · 计划：`docs/PLAN.md`
- 架构与数据模型：`docs/ARCHITECTURE.md` · 验收：`docs/ACCEPTANCE.md`
- 机制：`docs/MECHANISMS.md` · 状态：`docs/STATUS.md` · 日志：`docs/DEVLOG.md`
