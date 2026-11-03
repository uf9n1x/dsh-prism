# 架构

> 本文描述 Prism 的已落地实现。模块边界：核心图与领域逻辑不进 UI、不进提示词；依赖单向。

## 1. 单包组成

```
dsh-prism/
├── package.json            # bundle 声明：dsh.bundle.patch + dsh.client + 子路径 exports
├── cordis.patch.yml        # 全局 host 行：prism-host（不挂工具）+ prism-web（只读视图路由）
├── presets/
│   ├── prism.patch.yml         # 指挥官组合（prism）
│   └── prism-worker.patch.yml  # 工兵组合（prism-worker）
├── src/
│   ├── index.ts            # 包入口 = 全局 host 行（仅监听 subagent/end）
│   ├── graph/              # 图引擎：types / lock / store / frontier / validate（纯逻辑，无 UI）
│   ├── domain/             # mandate / assignment / report / event / effect / execution / scope / migrate
│   ├── engine/             # PrismEngine —— 唯一领域写者
│   ├── exec/               # backend（命令分类）+ local（异步）+ kali + ssh（OpenSSH）+ credential
│   ├── host/               # runtime（控制面）+ tools + commander + worker + webrow + cwd + config
│   ├── orchestrator/       # catalog（工具目录 / 结构断言）+ reconcile
│   ├── runtime/            # fastpath（事件）+ outbox + recover + watchdog + guardrails
│   ├── projection/         # readmodel（只读投影）+ untrusted（净化 / 脱敏）
│   └── protocol/           # commander / worker 的系统提示词 section
├── client/
│   └── prism-client.js     # 纯 JS 面板 bundle（手写，无 bundler）
└── tests/                  # 与 src 镜像
```

**依赖方向单向**：`graph → domain → engine → {exec, runtime, host, projection}`；`projection` 只读，不被任何写入方依赖。

工程约束：

- **零运行时依赖宿主包**：不 `import` 任何 `@deepseek-ai/*`，`prism_*` 工具以纯 JSON Schema 对象声明。
- **TypeScript ESM**：所有相对导入必须带 `.js` 扩展名。

## 2. 安装后的加载结构

`dsh.bundle.patch` 按序加载三层：

1. `cordis.patch.yml` —— 全局行 `prism-host`（始终加载但不挂工具）与 `prism-web`（只读视图 HTTP 路由，`inject: [webServer]`）。
2. `presets/prism.patch.yml` —— 注册 `prism`：persona / agent-instructions / ask-user / `dsh-prism/commander`。
3. `presets/prism-worker.patch.yml` —— 注册 `prism-worker`：bash / pwsh / fs / fs-search / `dsh-prism/worker`，不含 ask-user / goal / todo / subagent。

控制工具仅挂载于 `prism`，执行工具仅挂载于 `prism-worker`。普通会话不会加载任何 `prism_*` 工具或 Prism 提示词——隔离由组合关系保证，而非运行时开关。

## 3. 角色与工具面（结构性互斥）

| | `prism`（指挥官） | `prism-worker`（工兵） |
|---|---|---|
| 控制工具 | `prism_board` `prism_init` `prism_reason` `prism_hint` `prism_spawn` `prism_peek` `prism_msg` `prism_kill` `prism_verify` `prism_effect_resolve` `prism_capabilities` `prism_tighten` | — |
| 回报工具 | — | `prism_worker_report` `prism_evidence_add` |
| 执行工具 | —（不挂 shell / fs / web / MCP） | `prism_exec_start` `prism_exec_output` `prism_exec_stop` `prism_run` + 宿主 bash / pwsh / fs / fs-search |
| 交互 | 与用户对话 | 不直接向用户提问，以结构化 Report 交由指挥官处理 |

强制手段有两层：**组合层**（不同预设挂载不同插件行）与**运行时 `tools.guard()`**（执行前再次拦截执行类工具）；工兵在无绑定 Assignment 时任何执行均被拒绝。

## 4. 运行时与事件

控制面集中于 `src/host/runtime.ts`（`PrismRuntime`），通过三个可注入的接口与宿主解耦：派单/通讯（`NativeOps`）、唤醒指挥官（`WakeHooks.followup`）、审批（`ApprovalBroker`，缺失时 fail-closed）。

系统事件驱动，无定时器、无固定轮询：`src/index.ts` 仅监听 `subagent/end`。`runtime/fastpath.ts` 对每条入站事件给出五种出口之一：

- `duplicate` —— 去重键已存在，仍留痕但不路由；
- `filtered` —— 空体 / 自身事件；
- `route-assignment` —— 直接投递给绑定的工兵，不打扰指挥官；
- `coalesced` —— 冷却窗内合并；
- `wake` —— `agent.followup` 唤醒指挥官。

## 5. 执行后端

统一接口 `ExecutionBackend`：`healthCheck() / start() / output() / stop()`，全部异步。

- **LocalBackend**：Windows `cmd.exe` 执行，512KB 环形输出缓冲，`taskkill /T /F` 终止整棵进程树，`output()` 按字节游标增量返回。
- **KaliBackend**：通过系统 OpenSSH 客户端（`BatchMode=yes`、`StrictHostKeyChecking` 可配置）连接；未配置或不可达时返回 `verified:false` 并附带 ssh 诊断，`start()` 直接抛错，绝不返回模拟成功。

## 6. 只读界面与面板

- **数据通道**：`GET /prism/view?view=<board|graph|frontier|workers|evidence|report>&session=<id>`，同源只读。仅接受 session id，不接受任何路径参数；工作目录由宿主 session 解析后拼接 `.prism/`。普通会话即便目录中存在 `.prism/` 也返回 `present:false`（双重门禁：engagement 存在且该会话预设为 `prism`）。
- **面板**：`client/prism-client.js` 注册 `conversation.view#prism`（与「对话 / 轨迹」同排的会话页签）。顶部展示 `origin · goal` 与关键指标，下方为五个子页签：**图谱 / 前沿 / 工兵 / 证据 / 报告**，全部只读 `.prism/`，页签可见时每 4 秒刷新。
- **图谱**：同层 SVG，三列（事实 / 意图 / 派单），边为贝塞尔曲线（结果边虚线），节点可点选、键盘聚焦、悬停高亮相邻。报告、执行、证据的数量以活动计数展示，不逐条绘制为节点。

## 7. 前沿（Frontier）：图的工作队列

「前沿」不是一块独立存储，也不是一个动作，而是对整张意图图做一次**纯函数分类**得到的工作队列，回答"当前前沿上哪些工作可执行、哪些执行中、哪些受阻、哪些已完成"。指挥官每步经 `prism_board` 读取的 `frontier` 与面板「前沿」页签为同一份数据（`GET /prism/view?view=frontier` 直接返回 `board.frontier`）。

| 分类 | 判定（均由结构推导，见 `src/graph/frontier.ts`） |
|---|---|
| `done` | 已闭环（`to !== null`） |
| `running` | 开放且已被某 assignment 认领（`claimed_by !== null`） |
| `ready` / `available` | 开放、未被认领、`from` 引用的事实全部存在且（无需确认或已批准），即"当前可派单" |
| `blocked` | 开放但不可执行：前置事实缺失，或需确认而尚未批准 |

该分类为只读推导，不落盘、不可写、无镜像状态。设计上刻意不为每个意图维护 `status` 字段——状态始终由图结构实时计算，避免状态与结构不一致。`ready` 与 `available` 内容一致，前者用于语义表达，后者强调"可立即派单"。

## 8. 任务执行流程

```text
用户：新建任务 → 选择「Prism 渗透模式」→ 说明目标 / 授权 / 预期范围
  │
指挥官 prism_init       建立 engagement，铸造不可变 Mandate（目标 · 动作 · 强度 · 后端）
指挥官 prism_reason     读取事实 → 编写候选 Intent（from 引用已有事实）
指挥官 prism_spawn      派单给工兵（异步返回；接班时携带 resume_of）
  └─ 工兵 prism_exec_start → prism_exec_output（游标） → prism_exec_stop   经 ExecutionBackend 实际执行
  └─ 工兵 prism_worker_report  结构化回报 progress / waiting / ready / blocked / failed + facts + evidence
指挥官 prism_board      事实回图 → frontier 更新 → 决策下一轮
  （纠偏 prism_msg / 止损 prism_kill / 复核 prism_verify / 副作用 prism_effect_resolve）
```

关键语义：

- **意图仅在 `ready` 且携带事实时关闭**；`failed / cancelled` 的终态回报会释放 claim，使意图回到 frontier 重新派单——失败不视为结果。
- **同一 `dedupe_key` 的事件仅路由一次**：重复入站仍持久化留痕，但不会重复派单。
- **断点恢复**：崩溃时处于 `running` 的 Assignment 重启后标记为 `interrupted`（可经 `prism_spawn ... resume_of` 接手）；`pending` 副作用留于 outbox 待 drain；`unknown` 副作用禁止自动重放，须人工核查。

## 9. 设计取舍

核心设计（单个授权 engagement、指挥官经 Fact–Intent 图指挥可替换 worker、事件驱动可恢复、`.prism/` 权威存储、`PrismEngine` 唯一写者、不可变 Mandate、角色互斥、只读五视图、Windows 本机 + 可选 Kali）在实现中全部保留；以下为实现层与早期设计稿的差异及原因：

| 项 | 早期设想 | 实际做法 | 原因 |
|---|---|---|---|
| 预设声明 | 独立 `preset/<id>/` 目录 | `@deepseek-ai/dsh-agent-preset` 的 patch 行 | 贴合当前宿主的预设法 |
| 派生子代理 | 自建 `subagents.registerProvider` | 复用宿主 `subagents.startActivation` | 受"零运行时依赖"约束，无法 import 宿主包 |
| UI 数据通道 | `@Remote` + typert codegen | 同源只读 HTTP 路由（`/prism/view`） | codegen 仅在宿主 monorepo 构建期可用；视图契约独立，可平移 |
| 面板入口 | 右上角按钮 + 模态弹窗 | `conversation.view#prism` 会话页签 | 入口更符合预期；代价是无法按会话隐藏 |
| 推进机制 | 专门的 loop 模块 | 事件 fast-path（无定时器 / 轮询） | 以事件本身保证"无任务休眠"，更简单可靠 |
