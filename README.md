# Prism — 授权渗透 / 红队编排插件（DSH Desktop）

> **仅限已获得明确书面授权的安全测试、红队评估、CTF 与漏洞赏金场景。**
> 使用者须自行确认对目标拥有书面授权。作者不对未授权使用承担责任。

Prism 是 DSH Desktop 的一个自包含插件（bundle），安装后注册 **「Prism 渗透模式」** agent 预设。它将一次授权渗透任务拆分为「**指挥官决策 + 工兵执行**」两类角色：指挥官只做规划与派单，不直接执行扫描或利用；具体执行交由可替换的工兵子代理完成。二者通过一张持久化的 **事实—意图图（Fact–Intent graph）** 协同，全部状态落盘于工作目录的 `.prism/`，因而支持断点恢复、审计与只读观测。

默认在 **Windows 本机**执行，不依赖 Docker / Kali；Kali 及远程执行属可选项，连接失败时如实上报，绝不伪造成功。

---

## 目录

1. [设计目标](#1-设计目标)
2. [核心概念](#2-核心概念)
3. [架构](#3-架构)
4. [任务执行流程](#4-任务执行流程)
5. [数据模型（`.prism/`）](#5-数据模型prism)
6. [安装](#6-安装)
7. [使用](#7-使用)
8. [配置](#8-配置)
9. [安全与授权](#9-安全与授权)
10. [已知边界](#10-已知边界)
11. [设计取舍](#11-设计取舍)
12. [开发](#12-开发)
13. [文档](#13-文档)

---

## 1. 设计目标

渗透/红队任务通常是长链路、可中断且需要留痕的过程。通用对话型 Agent 直接承担此类任务存在两项结构性缺陷：

- **状态易失**：进展仅存于上下文，终止即丢失，无法断点续跑，也难以复核判断依据。
- **角色混杂**：同一模型既要决策"打哪里"又要亲自"动手"，易越权，且难以将执行体替换为更合适的后端。

Prism 通过领域模型而非提示词解决上述问题：

- 以不可变的事实节点与结构推导的意图记录"已知"与"下一步"，并完整落盘于 `.prism/`；
- 将决策与执行拆分为工具面互斥的两个预设（指挥官 / 工兵），隔离由组合关系保证，而非运行时开关；
- 以不可变授权凭证（Mandate）在执行前做确定性校验，模型无法通过提示词越权。

---

## 2. 核心概念

| 概念 | 说明 |
|---|---|
| **指挥官（commander）** | `prism` 预设。读取事实、编写意图、派单、纠偏、复核；不持有任何执行工具。 |
| **工兵（worker）** | `prism-worker` 预设。仅执行被指派的意图，并通过结构化报告回报；不持有任何控制工具。 |
| **事实（Fact）** | 不可变结论节点，携带证据引用，构成图的"已知"。 |
| **意图（Intent）** | 工作单元，`from` 引用事实、`to` 指向产出；是否就绪完全由图结构推导。 |
| **前沿（Frontier）** | 对意图图做一次分类得到的**工作队列**，分为 `ready / available / running / blocked / done` 五类；指挥官与面板共用同一份结果，不设独立状态字段。 |
| **派单（Assignment）** | 一次工兵执行尝试，独立于会话运行时状态，支持失败、重试、换人与接班。 |
| **报告（Report）** | 工兵的结构化回报：`progress / waiting / ready / blocked / failed / cancelled`。 |
| **Mandate** | 不可变授权凭证：目标 / 动作 / 后端 / 强度；只可收紧，不可放宽。 |
| **`.prism/`** | 领域唯一权威存储，一文件一节点；`PrismEngine` 为唯一写入口，界面只读投影。 |

---

## 3. 架构

### 3.1 单包组成

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

**依赖方向单向**：`graph → domain → engine → {exec, runtime, host, projection}`；`projection` 只读，不被任何写入方依赖。核心图与领域逻辑既不进入 UI，也不进入提示词。

工程约束：

- **零运行时依赖宿主包**：不 `import` 任何 `@deepseek-ai/*`，`prism_*` 工具以纯 JSON Schema 对象声明；安装包内为打包 JS，不依赖类型定义。
- **TypeScript ESM**：所有相对导入必须带 `.js` 扩展名。

### 3.2 安装后的加载结构

`dsh.bundle.patch` 按序加载三层：

1. `cordis.patch.yml` —— 全局行 `prism-host`（始终加载但不挂工具）与 `prism-web`（只读视图 HTTP 路由，`inject: [webServer]`）。
2. `presets/prism.patch.yml` —— 注册 `prism`：persona / agent-instructions / ask-user / `dsh-prism/commander`。
3. `presets/prism-worker.patch.yml` —— 注册 `prism-worker`：bash / pwsh / fs / fs-search / `dsh-prism/worker`，不含 ask-user / goal / todo / subagent。

控制工具仅挂载于 `prism`，执行工具仅挂载于 `prism-worker`。标准、编码、PPT 等普通会话不会加载任何 `prism_*` 工具或 Prism 提示词——隔离由组合关系保证，而非运行时开关。

### 3.3 角色与工具面（结构性互斥）

| | `prism`（指挥官） | `prism-worker`（工兵） |
|---|---|---|
| 控制工具 | `prism_board` `prism_init` `prism_reason` `prism_hint` `prism_spawn` `prism_peek` `prism_msg` `prism_kill` `prism_verify` `prism_effect_resolve` `prism_capabilities` `prism_tighten` | — |
| 回报工具 | — | `prism_worker_report` `prism_evidence_add` |
| 执行工具 | —（不挂 shell / fs / web / MCP） | `prism_exec_start` `prism_exec_output` `prism_exec_stop` `prism_run` + 宿主 bash / pwsh / fs / fs-search |
| 交互 | 与用户对话 | 不直接向用户提问，以结构化 Report 交由指挥官处理 |

强制手段有两层：**组合层**（不同预设挂载不同插件行）与**运行时 `tools.guard()`**（执行前再次拦截执行类工具）；工兵在无绑定 Assignment 时任何执行均被拒绝。

### 3.4 运行时与事件

控制面集中于 `src/host/runtime.ts`（`PrismRuntime`），通过三个可注入的接口与宿主解耦：派单/通讯（`NativeOps`）、唤醒指挥官（`WakeHooks.followup`）、审批（`ApprovalBroker`，缺失时 fail-closed）。

系统事件驱动，无定时器、无固定轮询：`src/index.ts` 仅监听 `subagent/end`。`runtime/fastpath.ts` 对每条入站事件给出五种出口之一——`duplicate`（去重键已存在，仍留痕但不路由）、`filtered`（空体 / 自身事件）、`route-assignment`（直接投递给绑定的工兵，不打扰指挥官）、`coalesced`（冷却窗内合并）、`wake`（`agent.followup` 唤醒指挥官）。

### 3.5 执行后端

统一接口 `ExecutionBackend`：`healthCheck() / start() / output() / stop()`，全部异步。

- **LocalBackend**：Windows `cmd.exe` 执行，512KB 环形输出缓冲，`taskkill /T /F` 终止整棵进程树，`output()` 按字节游标增量返回。
- **KaliBackend**：通过系统 OpenSSH 客户端（`BatchMode=yes`、`StrictHostKeyChecking` 可配置）连接；未配置或不可达时返回 `verified:false` 并附带 ssh 诊断，`start()` 直接抛错，绝不返回模拟成功。

### 3.6 只读界面与面板

- **数据通道**：`GET /prism/view?view=<board|graph|frontier|workers|evidence|report>&session=<id>`，同源只读。仅接受 session id，不接受任何路径参数；工作目录由宿主 session 解析后拼接 `.prism/`。普通会话即便目录中存在 `.prism/` 也返回 `present:false`（双重门禁：engagement 存在且该会话预设为 `prism`）。
- **面板**：`client/prism-client.js` 注册 `conversation.view#prism`（与「对话 / 轨迹」同排的会话页签）。顶部展示 `origin · goal` 与关键指标，下方为五个子页签：**图谱 / 前沿 / 工兵 / 证据 / 报告**，全部只读 `.prism/`，页签可见时每 4 秒刷新。
- **图谱**：同层 SVG，三列（事实 / 意图 / 派单），边为贝塞尔曲线（结果边虚线），节点可点选、键盘聚焦、悬停高亮相邻。报告、执行、证据的数量以活动计数展示，不逐条绘制为节点。

### 3.7 前沿（Frontier）：图的工作队列

「前沿」并非独立存储，也不是一个动作，而是对整张意图图做一次纯函数分类得到的工作队列，回答"当前前沿上哪些工作可执行、哪些执行中、哪些受阻、哪些已完成"。指挥官每步经 `prism_board` 读取的 `frontier` 与面板「前沿」页签为同一份数据（`GET /prism/view?view=frontier` 直接返回 `board.frontier`）。

| 分类 | 判定（均由结构推导，见 `src/graph/frontier.ts`） |
|---|---|
| `done` | 已闭环（`to !== null`） |
| `running` | 开放且已被某 assignment 认领（`claimed_by !== null`） |
| `ready` / `available` | 开放、未被认领、`from` 引用的事实全部存在且（无需确认或已批准），即"当前可派单" |
| `blocked` | 开放但不可执行：前置事实缺失，或需确认而尚未批准 |

该分类为只读推导，不落盘、不可写、无镜像状态。设计上刻意不为每个意图维护 `status` 字段——状态始终由图结构（前置事实是否齐备、是否被认领、是否已闭环）实时计算，避免状态与结构不一致。指挥官据此决定下一步派发哪个意图，人工在「前沿」页签看到的亦为此边界。`ready` 与 `available` 内容一致，前者用于语义表达，后者强调"可立即派单"。

---

## 4. 任务执行流程

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
- **断点恢复**：崩溃时处于 `running` 的 Assignment 重启后标记为 `interrupted`（计入可续，可经 `prism_spawn ... resume_of` 接手）；`pending` 副作用留于 outbox 待 drain；`unknown` 副作用禁止自动重放，须人工核查。

---

## 5. 数据模型（`.prism/`）

位置为会话工作目录下的 `<cwd>/.prism/`，一文件一节点，采用原子写（临时文件 → fsync → rename）+ 跨平台目录锁 + zod 校验。

```text
.prism/
├── project.json          # { id:'proj', schema_version, origin, authorization, goal, status, counters{...} }
├── facts/{goal,fNNN}.json        # 不可变
├── intents/iNNN.json             # { description, from[], to|null, confirm, approved, claimed_by, backend, stop_condition }
├── mandates/mNNN.json            # 不可变授权凭证
├── mandate_revocations/mdNNN.json
├── assignments/aNNN.json         # { intent_id, mandate_id, backend, worker_session, status, attempts, resume_of }
├── reports/rNNN.json             # { assignment_id, kind, text, facts[], evidence[] }
├── events/vNNN.json              # { source, dedupe_key, owner_session, status, filter_reason }
├── effects/xNNN.json             # Outbox：{ kind, payload, status, attempts, idempotent }
├── executions/xNNN.json          # { assignment_id, job_ref, command, status, output_cursor, side_effect, result }
├── hints/  workers/  messages/  evidence/
```

- **前沿（frontier）判定**（`src/graph/frontier.ts`）：`done` 为已闭环；`running` 为开放且被认领；`ready/available` 为开放且未被认领、`from` 事实全存在、且（无需确认或已批准）；`blocked` 为其余（缺前置事实或待确认）。状态完全由图结构推导，不设冗余状态镜像（Assignment / Execution 例外：二者本就记录执行尝试状态）。
- **不可变**：fact 与 mandate 同 ID 二次写入被拒绝；更正以新节点与关系表达。
- **引用完整性**：`from / to / evidence / claimed_by / mandate_id / assignment_id / intent_id` 必须指向存在实体。
- **schema 迁移**：`project.json` 携带 `schema_version`，旧版本经 `src/domain/migrate.ts` 显式升级后再校验。

---

## 6. 安装

本插件以本地 bundle 形式交付（`0.1.0`，`private`，未发布至 npm / 市场）。安装方式与其他 DSH 插件一致，仅"来源"填写本目录的绝对路径；安装后无需手动修改配置。

### 6.1 图形界面（推荐）

DSH Desktop →「插件」面板 →「安装 / 添加 bundle」→ 来源填入本插件目录的绝对路径（例如 `<path-to-dsh-prism>`）→ 返回 `application: "applied"` 即完成，运行中即时生效。

### 6.2 命令行（等价）

```bash
dsh plugin --profile desktop add "<path-to-dsh-prism>"
```

### 6.3 验证

启动后，新建任务的预设选择器中应出现 **「Prism 渗透模式」**；或核对组合配置：

```bash
dsh --profile desktop --dump-config | Select-String -Pattern 'prism-host|prism-web|preset-prism|Prism 渗透'
```

### 6.4 常见问题

- **重复安装**返回 `already-installed`：覆盖安装需先卸载再安装。
- **`ERR_PNPM_UNEXPECTED_STORE`**：该 profile 的 `node_modules` 由旧版 pnpm 链接，与 DSH 自带 pnpm 的新 store 不兼容（安装任意插件均可能遇到，与 Prism 无关）。请完全退出 DSH 后，在外部终端以与 DSH 同版本的 pnpm 对该 profile 执行一次 `install` 重新链接。
- **headless / ACP profile** 出现 `preset-prism ... pending (waiting for service: agentPresets)`：属正常现象，请使用包含 `agentPresets` / `webServer` 服务的 web / desktop profile。

### 6.5 卸载

于插件面板卸载，或执行 `dsh plugin --profile desktop remove dsh-prism`。数据不会被删除：`.prism/` 位于会话工作目录，与插件安装无关；如需彻底清理某次 engagement，手动删除该目录下的 `.prism/`。

---

## 7. 使用

### 7.1 快速上手

1. 新建任务，预设选择 **「Prism 渗透模式」**。
2. 用一句话说明目标、授权与预期范围，例如：
   - `已获授权测试 CTF 靶机 192.0.2.20（http://192.0.2.20/），先进行端口与服务侦察，再定位可利用点。`
   - `对本地 DVWA 192.0.2.30:8080 进行授权测试，已知 admin 凭据，先侦察再尝试登录。`
3. 指挥官随后自动初始化、编写待办、派发工兵；任务在后台推进，用户可在对话中继续纠偏、暂停或调整方向。
4. 打开会话页签 **「Prism」**，查看 图谱 / 前沿 / 工兵 / 证据 / 报告。

> **授权级别最关键**：默认 `strength: read`，仅覆盖侦察。若需写入、漏洞利用或获取 shell，请在开始时明确说明"允许 exploit / 写入"，指挥官初始化 Mandate 时会带上相应 `actions` 与 `strength`。范围一经建立即只可收紧、不可放宽，未授权的目标或动作将在执行前被拒绝。

### 7.2 恢复

任务状态完整保存在 `<工作目录>/.prism/`，重启后指挥官读取 `prism_board` 续跑；被中断的工兵可经 `prism_spawn ... resume_of` 接手。

---

## 8. 配置

全部配置写在对应 preset 行的 `config` 中，安装后无需改动。

### 8.1 Kali / 远程执行（可选，默认不启用）

未配置时纯本机运行；配置但不可达时返回 `verified:false` 及 ssh 诊断，绝不伪造成功。

```yaml
# presets/prism-worker.patch.yml 的 prism-worker 行
config:
  kali:
    host: 192.0.2.10
    user: kali
    identityFile: ~/.ssh/id_ed25519            # 方式 A：密钥文件路径
    # identityRef: cred://lab-ssh-key          # 方式 B（推荐）：经宿主 ctx.credentials 引用，不落盘
    connectTimeoutSec: 8                        # 取值 1–600
    strictHostKeyChecking: false                # 仅限实验虚拟机
```

### 8.2 审批开关

默认 `preAuthorized: true`（常驻预授权、不弹审批，面向已确定授权的任务）。范围检查不变；若在他人环境中使用，请设 `config.preAuthorized: false` 恢复人工闸门。

---

## 9. 安全与授权

- **模型无法文本提权**：目标 / 动作 / 后端 / 强度均由 `PrismEngine.authorize()` 判定。`execStart` 在启动前从命令行解析端点（URL host / IPv4 / CIDR / `user@host`）并逐一比对 targets，越界即拒绝，进程不会启动。
- **默认拒绝**：未知命令一律标记 `requires_confirm`；无审批通道时一律拒绝（fail-closed）。
- **授权收紧即暂停**：撤销或缩小范围时，立即将受影响的 Assignment 置为 `paused`。
- **凭据不落盘**：仅经宿主 `ctx.credentials` 引用；秘密值不进入 prompt / fact / evidence / 日志 / 界面。进程输出与投影在返回前经 `redactSecrets()` 脱敏。
- **目标内容视为数据而非指令**：注入 commander / worker 时以 `<<UNTRUSTED_DATA>> … <<END_UNTRUSTED_DATA>>` 包裹，转义伪造的闭合标记，剥离控制字符与 bidi 覆盖。

---

## 10. 已知边界

以下为尚未实现或尚未验证的项目，如实列出，不包装为已完成：

1. **命令中无法解析出端点时不做目标校验**：`whoami`、`cat /etc/passwd` 等不产生端点，约束它们的是 `actions` 而非 `targets`。
2. **回环地址恒在范围内**：`127.0.0.1 / localhost / ::1 / 0.0.0.0` 视为本机，不受 targets 约束。
3. **事实去重仅识别完全相同的 `title+summary`**：换一种表述的同一结论仍会产生新 fact。
4. **同一 `.prism/` 不支持多进程并发写**：同进程内以"每 root 只恢复一次"兜底，跨进程无租约。
5. **Kali 镜像本体未实测**：SSH 通道已在 Ubuntu 主机真机验证，但目标机是否为 Kali 未测。
6. **Linux / macOS 本机执行后端未实测**（仅验证 Windows 路径）。
7. **非 Prism 会话亦会看到「Prism」页签**：`conversation.view` 注册项无法按会话隐藏，点开为空态说明。
8. **客户端为手写纯 JS，无类型检查**：具备契约测试，但无 TS 类型约束。

---

## 11. 设计取舍

**核心设计保持不变，落地实现集中在"如何接入宿主"层面。**

最初设想（以 `docs/SPEC.md` 为单一事实源）：可安装 bundle →「Prism 渗透模式」；面向单个授权 engagement；指挥官经 Fact–Intent 图指挥可替换 worker；事件驱动、可恢复；`.prism/` 为领域权威存储；`PrismEngine` 为唯一写者；不可变 Mandate 提供硬授权；角色工具面结构性互斥；只读五视图；Windows 本机 + 可选 Kali。上述目标均已保留并实现。

实现层相对早期设计稿的差异（详见 `docs/PLAN.md`「实际落地对照」与 `docs/DECISIONS.md`）：

| 项 | 早期设想 | 实际做法 | 原因 |
|---|---|---|---|
| 预设声明 | 独立 `preset/<id>/` 目录 | `@deepseek-ai/dsh-agent-preset` 的 patch 行 | 贴合当前宿主的预设法 |
| 派生子代理 | 自建 `subagents.registerProvider` | 复用宿主 `subagents.startActivation` | 受"零运行时依赖"约束，无法 import 宿主包 |
| UI 数据通道 | `@Remote` + typert codegen | 同源只读 HTTP 路由（`/prism/view`） | codegen 仅在宿主 monorepo 构建期可用；视图契约独立，可平移 |
| 面板入口 | 右上角按钮 + 模态弹窗 | `conversation.view#prism` 会话页签 | 入口更符合预期；代价是无法按会话隐藏（见边界第 7 条） |
| 推进机制 | 专门的 loop 模块 | 事件 fast-path（无定时器 / 轮询） | 以事件本身保证"无任务休眠"，更简单可靠 |

以上差异均不改变产品范围，而是在当前宿主接口下以更小、更稳的方式实现同一设计。

---

## 12. 开发

```bash
npm run typecheck     # tsc --noEmit
npm run build         # 构建 lib/
npm test              # vitest run
npm run verify        # typecheck + build + test
```

- 需要 Node ≥ 20（构建 / 测试用；运行由 DSH 宿主提供）。`vitest@4` 在 Node 21 上启动即崩（`util.styleText`），请使用 Node 22 或 24。
- 代码约束：TypeScript ESM（相对导入带 `.js`）；两空格缩进、单引号、无分号；不 import 任何 `@deepseek-ai/*`；`src/x/y.ts ↔ tests/x/y.spec.ts` 镜像。

---

## 13. 文档

| 文件 | 内容 |
|---|---|
| `docs/SPEC.md` | 产品目标、边界、领域模型与验收的单一事实源 |
| `docs/ARCHITECTURE.md` | 已落地的模块布局、数据模型、运行时、执行后端与投影 |
| `docs/DECISIONS.md` | 关键设计决策记录（ADR） |
| `docs/PLAN.md` | 计划与「实际落地对照」（逐条标注偏离） |
| `docs/ACCEPTANCE.md` | 验收项与证据映射 |
