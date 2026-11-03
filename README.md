# Prism — 授权渗透 / 红队编排插件（DSH Desktop）

> ⚠️ **仅用于获得明确书面授权的安全测试、红队评估、CTF 与漏洞赏金。**
> 使用者须自行确认对目标拥有书面授权。作者不对未授权使用负责。

Prism 是 DSH Desktop 的一个**自包含插件（bundle）**，安装后注册一个叫 **「Prism 渗透模式」** 的 agent 预设。它把一次授权渗透任务拆成「**指挥官决定做什么 + 工兵去执行**」：指挥官只做规划与派单，永远不亲自跑扫描/利用；执行交给可替换的工兵子代理。两者通过一张持久化的**事实—意图图（Fact–Intent graph）**协作，所有状态落在工作目录的 `.prism/` 里，因此可以断点恢复、可审计、可被只读面板观测。

默认 **Windows 本机**执行，**不依赖 Docker / Kali**；Kali/远程执行是可选项，接不上会如实报失败，绝不伪造成功。

---

## 目录

1. [它解决什么问题](#1-它解决什么问题)
2. [核心概念](#2-核心概念)
3. [架构](#3-架构)
4. [一次任务如何流转](#4-一次任务如何流转)
5. [数据模型（`.prism/`）](#5-数据模型prism)
6. [安装](#6-安装)
7. [使用](#7-使用)
8. [配置](#8-配置)
9. [安全与授权](#9-安全与授权)
10. [已知边界](#10-已知边界)
11. [设计取舍：与最初设想的关系](#11-设计取舍与最初设想的关系)
12. [开发](#12-开发)
13. [文档](#13-文档)

---

## 1. 它解决什么问题

一次渗透/红队任务本质是一个**长链路、可中断、需要留痕**的过程：侦察 → 发现 → 决策下一步 → 执行 → 再发现。通用聊天型 Agent 做这件事有两个硬伤：

- **状态漂移**：进展存在上下文里，关掉就丢，无法断点续跑，也无法复核"我当时凭什么这么判断"。
- **角色混杂**：同一个模型既要决定"打哪"，又要亲自"动手"，容易越权、也难把执行替换成更合适的执行体。

Prism 的取舍是把这两点交给**领域模型**而不是提示词：

- 用**不可变的事实 + 结构推导的意图**记录"知道了什么、下一步干什么"，全量落盘在 `.prism/`；
- 把"决策"和"执行"拆成两个**工具面互斥**的预设（指挥官 / 工兵），隔离靠组合而非运行时开关；
- 用**不可变授权凭证（Mandate）**在每次执行前做确定性校验，模型无法靠"说"越权。

---

## 2. 核心概念

| 概念 | 含义 |
|---|---|
| **指挥官（commander）** | `prism` 预设。读事实、写意图、派单、纠偏、复核。**没有任何执行工具**。 |
| **工兵（worker）** | `prism-worker` 预设。只执行被派的某个意图，用结构化报告回报。**没有任何控制工具**。 |
| **事实（Fact）** | 不可变结论节点，带证据引用。图的"已知"。 |
| **意图（Intent）** | 工作单元，`from` 引用事实、`to` 指向产出。是否"就绪"完全由图结构推导。 |
| **前沿（Frontier）** | 对整张意图图做一次分类得到的**工作队列**，分 `ready / available / running / blocked / done` 五个桶；指挥官派单与面板都读它，没有独立的 status 字段。 |
| **派单（Assignment）** | 一次工兵执行尝试，独立于会话运行时状态，可失败/重试/换人/接班。 |
| **报告（Report）** | 工兵的结构化回报：`progress / waiting / ready / blocked / failed / cancelled`。 |
| **Mandate** | 不可变授权凭证：目标 / 动作 / 后端 / 强度。只能收紧，不能放宽。 |
| **`.prism/`** | 领域**唯一权威存储**，一文件一节点；`PrismEngine` 是唯一写入口，UI 只读投影。 |

---

## 3. 架构

### 3.1 单包组成

```
dsh-prism/
├── package.json            # bundle 声明：dsh.bundle.patch + dsh.client + 子路径 exports
├── cordis.patch.yml        # 全局 host 行：prism-host（零工具）+ prism-web（只读视图路由）
├── presets/
│   ├── prism.patch.yml         # 指挥官组合（prism）
│   └── prism-worker.patch.yml  # 工兵组合（prism-worker）
├── src/
│   ├── index.ts            # 包入口 = 全局 host 行（只监听 subagent/end）
│   ├── graph/              # 图引擎：types / lock / store / frontier / validate（纯，无 UI）
│   ├── domain/             # mandate / assignment / report / event / effect / execution / scope / migrate
│   ├── engine/             # PrismEngine —— 唯一领域写者
│   ├── exec/               # backend(命令分类) + local(异步) + kali + ssh(OpenSSH) + credential
│   ├── host/               # runtime(控制面) + tools + commander + worker + webrow + cwd + config
│   ├── orchestrator/       # catalog(工具目录/结构断言) + reconcile
│   ├── runtime/            # fastpath(事件) + outbox + recover + watchdog + guardrails
│   ├── projection/         # readmodel(只读投影) + untrusted(净化/脱敏)
│   └── protocol/           # commander / worker 的系统提示词 section
├── client/
│   └── prism-client.js     # 纯 JS 面板 bundle（手写，无 bundler）
└── tests/                  # 与 src 镜像
```

**依赖方向单向**：`graph → domain → engine → {exec, runtime, host, projection}`；`projection` 只读、不被写入方依赖。核心图/领域逻辑不进 UI 也不进提示词。

**两个工程约束**：
- **零运行时依赖 DSH 包**：不 `import` 任何 `@deepseek-ai/*`，`prism_*` 工具用纯 JSON Schema 对象声明，安装包里只有打包 JS，不依赖 `.d.ts`。
- **TypeScript ESM**：相对导入必须带 `.js`。

### 3.2 安装后加载什么

`dsh.bundle.patch` 按序加载三层：

1. `cordis.patch.yml` —— 全局行 `prism-host`（永远加载但**零工具**）与 `prism-web`（只读视图 HTTP 路由，`inject: [webServer]`）。
2. `presets/prism.patch.yml` —— 注册 `prism`：persona / agent-instructions / ask-user / **`dsh-prism/commander`**。
3. `presets/prism-worker.patch.yml` —— 注册 `prism-worker`：bash / pwsh / fs / fs-search / **`dsh-prism/worker`**，**不含** ask-user / goal / todo / subagent。

> 控制工具只挂进 `prism`，执行工具只挂进 `prism-worker`。**普通会话（标准/编码/PPT）不会加载任何 `prism_*` 工具和 Prism 提示词**——隔离由"组合"保证，而不是运行时开关。

### 3.3 角色与工具面（结构性互斥）

| | `prism`（指挥官） | `prism-worker`（工兵） |
|---|---|---|
| 控制工具 | `prism_board` `prism_init` `prism_reason` `prism_hint` `prism_spawn` `prism_peek` `prism_msg` `prism_kill` `prism_verify` `prism_effect_resolve` `prism_capabilities` `prism_tighten` | ❌ |
| 回报工具 | ❌ | `prism_worker_report` `prism_evidence_add` |
| 执行工具 | ❌（不挂 shell/fs/web/MCP） | `prism_exec_start` `prism_exec_output` `prism_exec_stop` `prism_run` + 宿主 bash/pwsh/fs/fs-search |
| 交互 | 与用户对话 | 不向用户提问，用结构化 Report 交给指挥官 |

强制有两层：**组合层**（不同 preset 挂不同插件行）+ **运行时 `tools.guard()`**（执行前再拦截一次执行类工具）；工兵无绑定 Assignment 时任何执行直接拒绝。

### 3.4 运行时与事件

控制面集中在 `src/host/runtime.ts`（`PrismRuntime`），通过三个可注入的缝与宿主解耦：派单/通讯（`NativeOps`）、唤醒指挥官（`WakeHooks.followup`）、审批（`ApprovalBroker`，缺失时 fail-closed）。

事件驱动，**无定时器、无固定轮询**：`src/index.ts` 只挂 `subagent/end` 监听；`runtime/fastpath.ts` 对每条入站事件给出五选一出口——`duplicate`（去重键已存在，仍留痕但不路由）/ `filtered`（空体/自身事件）/ `route-assignment`（直接投递给绑定的工兵，不打扰指挥官）/ `coalesced`（冷却窗内合并）/ `wake`（`agent.followup` 唤醒指挥官）。

### 3.5 执行后端

统一接口 `ExecutionBackend`：`healthCheck() / start() / output() / stop()`，全异步。

- **LocalBackend**：Windows `cmd.exe`，512KB 环形输出缓冲，`taskkill /T /F` 杀整棵进程树，`output()` 按字节游标增量返回。
- **KaliBackend**：经系统 **OpenSSH** 客户端（`BatchMode=yes`、`StrictHostKeyChecking` 可配），未配置或连不上时 `verified:false` 并返回 ssh 自身诊断，`start()` 直接抛错——**绝不返回模拟成功**。

### 3.6 只读 UI 与面板

- **数据通道**：`GET /prism/view?view=<board|graph|frontier|workers|evidence|report>&session=<id>`，同源只读。**只接受 session id，不接受任何路径参数**；cwd 由宿主 session 解析后拼 `.prism/`。普通会话即使目录里有 `.prism/` 也会返回 `present:false`（双重门禁：engagement 存在 ∧ 该会话预设是 `prism`）。
- **面板**：`client/prism-client.js` 注册 `conversation.view#prism` —— 与「对话 / 轨迹」同排的会话页签。顶部 `origin · goal` + KPI，下面五个子页签：**图谱 / 前沿 / 工兵 / 证据 / 报告**，全部只读 `.prism/`，页签可见时每 4 秒刷新。
- **图谱**：同层 SVG，三列（事实 / 意图 / 派单），边为贝塞尔曲线（结果边虚线），节点可点选/键盘聚焦/悬停高亮相邻。报告、执行、证据的数量在标题行动态显示，不逐条画成节点。

### 3.7 前沿（Frontier）：图的工作队列

"前沿"不是一块独立存储，也不是一个动作，而是**对整张意图图做一次纯函数分类**得到的工作队列——它回答"现在图的前沿上，哪些活能做、哪些在做、哪些被卡住、哪些已完成"。指挥官每步用 `prism_board` 读到的 `frontier`，和面板的「前沿」页签，是**同一份数据**（`GET /prism/view?view=frontier` 直接返回 `board.frontier`）。

| 桶 | 判定（全部由结构推导，见 `src/graph/frontier.ts`） |
|---|---|
| `done` | 已闭环（`to !== null`） |
| `running` | 开放且已被某个 assignment 认领（`claimed_by !== null`） |
| `ready` / `available` | 开放、未被认领、`from` 引用的**事实全部存在**、且（无需确认或已批准）——即"现在就能派单" |
| `blocked` | 开放但不可做：前置事实缺失，或需要确认但还没批准 |

定位上它是**只读推导**：不落盘、不可写、无镜像状态。它取代了"给每个 intent 维护一个 status 字段"的做法——状态永远由图结构（from 事实是否齐、是否被认领、是否已闭环）当场算出。指挥官据此决定"下一步 spawn 哪个 intent"，人工在「前沿」页签看到的就是这个边界；`ready` 与 `available` 内容相同，前者用于语义表达、后者强调"可立即派单"。

---

## 4. 一次任务如何流转

```text
用户：新建任务 → 选「Prism 渗透模式」→ 说清 目标 / 授权 / 想到哪一步
  │
指挥官 prism_init       建立 engagement，铸造不可变 Mandate（目标·动作·强度·后端）
指挥官 prism_reason     读事实 → 写候选 Intent（from 引用已有事实）
指挥官 prism_spawn      派单给工兵（异步返回；接班带 resume_of）
  └─ 工兵 prism_exec_start → prism_exec_output(游标) → prism_exec_stop   经 ExecutionBackend 真跑
  └─ 工兵 prism_worker_report  结构化回报 progress/waiting/ready/blocked/failed + facts + evidence
指挥官 prism_board      事实回图 → frontier 更新 → 决策下一轮
  （纠偏 prism_msg / 止损 prism_kill / 复核 prism_verify / 副作用 prism_effect_resolve）
```

**关键语义**：

- **意图只在 `ready` 且带事实时关闭**；`failed / cancelled` 的终态回报会释放 claim，让意图回到 frontier 重新派单——失败不是结果。
- **同一 `dedupe_key` 的事件只路由一次**：重复入站仍持久化留痕，但不会重复派单。
- **断点恢复**：崩溃时 `running` 的 Assignment 重启后标 `interrupted`（计入可续，用 `prism_spawn ... resume_of` 接手）；`pending` 副作用留在 outbox 待 drain；**`unknown` 副作用禁止自动重放**，必须人工核查。

---

## 5. 数据模型（`.prism/`）

位置：**会话工作目录**下的 `<cwd>/.prism/`，一文件一节点，原子写（临时文件 → fsync → rename）+ 跨平台目录锁 + zod 校验。

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

- **前沿（frontier）判定**（`src/graph/frontier.ts`）：`done`=已闭环；`running`=开放且被认领；`ready/available`=开放∧未被认领∧`from` 事实全存在∧（无需确认或已批准）；`blocked`=其余（缺前置事实或待确认）。状态完全由图结构推导，**不设冗余 status 镜像**（Assignment / Execution 例外：它们本就记录执行尝试状态）。
- **不可变**：fact、mandate 同 ID 二次写被拒绝；"更正" = 新节点 + 关系。
- **引用完整性**：`from / to / evidence / claimed_by / mandate_id / assignment_id / intent_id` 必须指向存在实体。
- **schema 迁移**：`project.json` 带 `schema_version`，旧版本经 `src/domain/migrate.ts` 显式升级后再校验。

---

## 6. 安装

本插件以**本地 bundle** 交付（`0.1.0`，`private`，未发布到 npm/市场）。安装方式与其它 DSH 插件相同，只是“来源”填本目录的**绝对路径**。装好后不需要手改任何配置。

### 6.1 图形界面（推荐）

DSH Desktop →「插件」面板 →「安装 / 添加 bundle」→ 来源填本目录绝对路径（如 `<path-to-dsh-prism>`）→ 返回 `application: "applied"` 即完成，运行中即时生效。

### 6.2 命令行（等价）

```bash
dsh plugin --profile desktop add "<path-to-dsh-prism>"
```

### 6.3 验证

启动后在**新建任务**的左下角预设选择器里应出现 **「Prism 渗透模式」**；或核对组合配置：

```bash
dsh --profile desktop --dump-config | Select-String -Pattern 'prism-host|prism-web|preset-prism|Prism 渗透'
```

### 6.4 常见问题

- **已装过再装**返回 `already-installed`：**覆盖安装要先卸载再装**。
- **`ERR_PNPM_UNEXPECTED_STORE`**：profile 的 `node_modules` 是旧版 pnpm 链的，与 DSH 自带 pnpm 的新 store 不兼容（装任何插件都可能遇到，与 Prism 无关）。**完全退出 DSH** 后，在外部终端用与 DSH 同版本的 pnpm 对该 profile 跑一次 `install` 重链即可。
- **headless / ACP profile** 会出现 `preset-prism ... pending (waiting for service: agentPresets)`：这是正常现象，请用带 `agentPresets` / `webServer` 的 **web / desktop profile**（也就是正常客户端）。

### 6.5 卸载

插件面板卸载，或 `dsh plugin --profile desktop remove dsh-prism`。**数据不会被删**：`.prism/` 在会话工作目录里，与插件安装无关；要彻底清理某次 engagement，手动删除该目录下的 `.prism/`。

---

## 7. 使用

### 7.1 快速上手

1. **新建任务**，左下角预设选 **「Prism 渗透模式」**。
2. **一句话说清 目标 + 授权 + 想到哪一步**，例如：
   - `我获授权测试 CTF 靶机 192.0.2.20（http://192.0.2.20/），先做端口与服务侦察，再找可利用点。`
   - `对本地 DVWA 192.0.2.10:8080 做授权测试，admin/password 已知，先侦察再尝试登录。`
3. 之后指挥官会自动初始化、出待办、派工兵；任务在后台推进，你可以在对话里继续纠偏/暂停/换方向。
4. 点开会话页签 **「Prism」** 看 图谱 / 前沿 / 工兵 / 证据 / 报告。

> **授权级别最关键**：默认 `strength: read`，只够侦察。需要**写入 / 漏洞利用 / 拿 shell**，请一开始就明确说"**允许 exploit / 写入**"，指挥官初始化 Mandate 时会带上相应 `actions` 与 `strength`。范围建好后**只能收紧、不能放宽**，未授权目标/动作会在**执行前**被拒绝。

### 7.2 恢复

关掉再开不丢：状态都在 `<工作目录>/.prism/`。重开后指挥官读 `prism_board` 续跑，被中断的工兵可用 `prism_spawn ... resume_of` 接手。

---

## 8. 配置

所有配置写在**对应 preset 行**的 `config` 里（装好后无需改）。

### 8.1 Kali / 远程执行（可选，默认不启用）

不配置就纯本机运行；配置了但连不上会 `verified:false` 并返回 ssh 诊断，不会伪造成功。

```yaml
# presets/prism-worker.patch.yml 的 prism-worker 行
config:
  kali:
    host: 192.0.2.10
    user: user
    identityFile: C:/Users/you/.ssh/id_ed25519   # 方式A：密钥文件路径
    # identityRef: cred://lab-ssh-key            # 方式B（推荐）：走宿主 ctx.credentials 引用，不落盘
    connectTimeoutSec: 8                          # 1–600
    strictHostKeyChecking: false                  # 仅 lab 虚拟机可关
```

### 8.2 审批开关

默认 `preAuthorized: true`（常驻预授权、不弹审批，面向**已确定授权**的任务）。范围检查一条都没少；如果你在别人的环境里用，请设 `config.preAuthorized: false` 把人工闸门开回来。

---

## 9. 安全与授权

- **模型不能文本提权**：目标/动作/后端/强度全部在 `PrismEngine.authorize()` 里判定；`execStart` 会在启动前**从命令行解析端点**（URL host / IPv4 / CIDR / `user@host`）逐个比对 targets，越界即拒绝，进程不启动。
- **默认拒绝**：未知命令一律 `requires_confirm`；无审批通道时一律拒绝（fail-closed）。
- **授权收紧即暂停**：撤销或缩小范围时，立即 `paused` 受影响的 Assignment。
- **凭据不落盘**：只经宿主 `ctx.credentials` 引用；秘密值不进 prompt/fact/evidence/日志/UI。进程输出与投影在返回前经 `redactSecrets()`。
- **目标内容是数据不是指令**：注入 commander/worker 时用 `<<UNTRUSTED_DATA>> … <<END_UNTRUSTED_DATA>>` 包裹，转义伪造闭合标记、剥离控制字符与 bidi 覆盖。

---

## 10. 已知边界

以下是**尚未实现或未验证**的项，如实列出（不包装成"已完成"）：

1. **命令解析不出端点时不做目标校验**：`whoami`、`cat /etc/passwd` 这类不产生端点，拦住它们的是 `actions` 而非 `targets`。
2. **回环地址恒在范围内**：`127.0.0.1 / localhost / ::1 / 0.0.0.0` 视为本机，不受 targets 约束。
3. **事实去重只认完全相同的 `title+summary`**：换个说法说同一结论仍会产生新 fact。
4. **同一 `.prism/` 不支持多进程并发写**：同进程内靠"每 root 只恢复一次"兜住，跨进程无租约。
5. **Kali 镜像本体未实测**：SSH 通道已在 Ubuntu 上真机验证，但目标机是否是 Kali 未测。
6. **Linux / macOS 本机执行后端未实测**（仅 Windows 路径验证）。
7. **非 Prism 会话也会看到「Prism」页签**：`conversation.view` 的注册项无法按会话隐藏，点开是一句空态说明。
8. **客户端为手写纯 JS、无类型检查**：有契约测试，但没有 TS 类型约束。

---

## 11. 设计取舍：与最初设想的关系

**结论：核心设想没有偏离，落地的都是同一套设计；偏离集中在"怎么接到宿主"这类实现层，且都有记录。**

最初设想（`docs/SPEC.md` 为单一事实源）：可安装 bundle → 「Prism 渗透模式」；面向**单个授权 engagement**；**指挥官经 Fact–Intent 图指挥可替换 worker**；事件驱动自动推进、可恢复；`.prism/` 为领域权威存储；`PrismEngine` 唯一写者；不可变 Mandate 做硬授权；角色工具面结构性互斥；Remote 五视图只读投影；Windows 本机 + 可选 Kali。这些**全部保留并实现**。

实现层相对早期设计稿的偏离（详见 `docs/PLAN.md`「实际落地对照」与 `docs/DECISIONS.md`）：

| 项 | 早期设想 | 实际做法 | 原因 |
|---|---|---|---|
| 预设声明 | 独立 `preset/<id>/` 目录 | `@deepseek-ai/dsh-agent-preset` 的 patch 行 | 贴合当前宿主的预设法 |
| 派生子代理 | 自建 `subagents.registerProvider` | 复用宿主 `subagents.startActivation` | 零运行时依赖约束，无法 import 宿主包 |
| UI 数据通道 | `@Remote` + typert codegen | 同源只读 HTTP 路由（`/prism/view`） | codegen 只在宿主 monorepo 构建期有；视图契约独立，将来可平移 |
| 面板入口 | 右上角按钮 + 模态弹窗 | `conversation.view#prism` 会话页签 | 入口更符合预期；代价是无法按会话隐藏（见边界 7） |
| 推进机制 | 专门的 loop 模块 | 事件 fast-path（无定时器/轮询） | 用事件本身保证"无任务休眠"，更简单可靠 |

这些都不是"产品范围变了"，而是**在当前宿主接口下，用更小、更稳的接法实现同一个设计**。

---

## 12. 开发

```bash
npm run typecheck     # tsc --noEmit
npm run build         # 构建 lib/
npm test              # vitest run
npm run verify        # typecheck + build + test
```

- 需要 **Node ≥ 20**（构建/测试用；运行由 DSH 宿主提供运行时）。注意 `vitest@4` 在 **Node 21 上启动即崩**（`util.styleText`），请用 Node 22 或 24。
- 代码约束：TypeScript ESM（相对导入带 `.js`）、两空格单引号无分号、不 import 任何 `@deepseek-ai/*`、`src/x/y.ts ↔ tests/x/y.spec.ts` 镜像。

---

## 13. 文档

| 文件 | 内容 |
|---|---|
| `docs/SPEC.md` | 产品目标、边界、域模型、验收的单一事实源 |
| `docs/ARCHITECTURE.md` | 已落地的模块布局、数据模型、运行时、执行后端、投影 |
| `docs/DECISIONS.md` | 关键设计决策记录（ADR） |
| `docs/PLAN.md` | 计划与「实际落地对照」（逐条标注偏离） |
| `docs/ACCEPTANCE.md` | 验收项与证据映射 |
