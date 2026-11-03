# Prism — DSH 渗透 / 红队编排插件

> ⚠️ **仅限获得明确书面授权的安全测试、红队评估、CTF 与漏洞赏金。**
> 使用者须自行确认对目标拥有书面授权，作者不对未授权使用承担责任。

面向 [DSH Desktop](https://github.com/deepseek-ai/deepseek-harness) 的渗透测试模式：**指挥官只决策、工兵只执行**，两者通过一张持久化的**事实—意图图（Fact–Intent graph）**协同，把一次授权渗透任务事件驱动地自动推进下去。全部状态落盘于工作目录的 `.prism/`，支持断点恢复、审计与只读面板观测。默认 Windows 本机执行，不依赖 Docker / Kali；远程执行为可选项，连接失败如实上报。

## 特性

- **角色结构性互斥**：指挥官（`prism`）与工兵（`prism-worker`）是两个工具面不相交的预设——指挥官没有任何执行工具，工兵没有任何控制工具；普通会话零加载 Prism 提示词与工具。
- **事实—意图图**：不可变事实 + 结构推导的意图 + 不可变授权凭证（Mandate），原子写、目录锁、schema 校验，`PrismEngine` 唯一写入口。
- **事件驱动推进**：无定时器、无固定轮询；事件去重、按 assignment 直投、冷却合并、`agent.followup` 唤醒。
- **硬授权**：执行前从命令行解析端点逐一比对 Mandate targets，越界即拒绝；范围只可收紧，收紧即暂停。
- **五视图只读面板**：图谱 / 前沿 / 工兵 / 证据 / 报告，同源只读 `.prism/`，会话页签内 4 秒自动刷新。
- **可替换执行后端**：Windows 本机异步执行（进程树管理、游标增量输出）+ 可选 Kali（系统 OpenSSH，失败不伪造）。

## 安装（从源码）

本项目以源码形态分发，构建后作为本地 bundle 安装：

```bash
git clone https://github.com/uf9n1x/dsh-prism.git
cd dsh-prism
npm install
npm run build          # 产出 lib/
```

```powershell
dsh plugin --profile desktop add "D:\path\to\dsh-prism"
```

**验证**：重启 DSH 后，新建任务的预设选择器出现 **「Prism 渗透模式」**；或
`dsh --profile desktop --dump-config | Select-String prism`（应含 `prism-host` / `prism-web` / `preset-prism`）。

**卸载**：插件面板卸载，或 `dsh plugin --profile desktop remove dsh-prism`；`.prism/` 数据不会被删除。

环境要求与安装排错见 [docs/known-limits.md](docs/known-limits.md)。

## 快速上手

1. 新建任务，预设选 **「Prism 渗透模式」**；
2. 一句话说明**目标 + 授权 + 范围**，例如：`已获授权测试 CTF 靶机 192.0.2.20，先侦察再定位可利用点。`
3. 指挥官自动初始化、写待办、派工兵；对话中可随时纠偏 / 暂停；
4. 会话页签 **「Prism」** 查看五视图。

> 授权级别最关键：默认 `strength: read` 仅够侦察；需要利用 / 写入请一开始明确说明。详见 [docs/security.md](docs/security.md)。

## 架构速览

```
graph → domain → engine → { exec, runtime, host, projection }
```

| 模块 | 职责 |
|---|---|
| `graph/` | 图引擎：一文件一节点、原子写、目录锁、frontier 结构推导 |
| `domain/` | Mandate / Assignment / Report / EventRecord / Effect / ExecutionRecord |
| `engine/` | `PrismEngine` —— 唯一领域写者 |
| `exec/` | LocalBackend（Windows 异步）+ KaliBackend（OpenSSH） |
| `host/` | 控制面 runtime、`prism_*` 工具、只读视图路由 |
| `runtime/` | 事件 fast-path、outbox、恢复、受限 watchdog |
| `projection/` | 只读投影（board/graph/workers/evidence/report）+ 不可信数据净化 |
| `client/` | 纯 JS 面板（五视图会话页签） |

## 文档

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 模块布局、角色工具面、事件运行时、执行后端、前沿判定、任务流程、设计取舍 |
| [docs/data-model.md](docs/data-model.md) | `.prism/` 目录结构、写保证、frontier 判定、不变量 |
| [docs/security.md](docs/security.md) | Mandate 授权模型、执行前校验、凭据脱敏、不可信数据 |
| [docs/usage.md](docs/usage.md) | 快速上手、恢复、Kali / 审批配置、卸载 |
| [docs/known-limits.md](docs/known-limits.md) | 已知边界、常见问题、环境要求 |

## 参考项目

- [nvwabase · 女娲基座](https://github.com/N1nEmAn/nvwabase) —— 事实—意图图机制的灵感来源。
- [sapper-v2](https://github.com/N1nEmAn/sapper-v2) —— 多 Agent 渗透协作的编排思路参照。
- [dsh-pentest](https://github.com/howmp/dsh-pentest) —— 同类 DSH bundle 的包结构参照。

## License

[MIT](LICENSE)
