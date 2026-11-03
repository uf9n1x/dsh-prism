# Prism — 授权红队 / 渗透模式（DSH Desktop 插件）

> ⚠️ **仅用于获得明确书面授权的安全测试、红队评估、CTF 与漏洞赏金。**
> 作者不对未授权使用负责。使用者须自行确认对目标拥有书面授权。

Prism 是 DSH Desktop 的一个**自包含 bundle**：注册 **「Prism 渗透模式」** agent preset，由**指挥官主 Agent**通过**事实—意图图**指挥**可替换的工兵子代理**，事件驱动自动推进授权渗透任务。所有结论、证据、状态、交接持久化在会话工作目录的 `.prism/` 下，可断点恢复。**默认 Windows 本机运行，不依赖 Docker / Kali。**

---

## 1. 交付状态

| 项 | 状态 |
|---|---|
| 源码 + 测试 | ✅ `src/` **34** 个 TS 文件 + `client/` 纯 JS bundle；`tests/` **23 文件 / 187 项全绿** |
| 构建 | ✅ `npx tsc -p tsconfig.json` → exit 0，产出 `lib/` |
| 真实安装 | ✅ 独立 profile 上 `dsh plugin add` 成功，页面出现「Prism 渗透模式」 |
| 真实卸载 | ✅ `plugin remove` 后 bundle 清单与配置零 Prism 行 |
| 运行态热应用 | ✅ 运行中宿主 `installBundle` / `removeBundle` 均返回 `application: "applied"` |
| 五视图 UI | ✅ 会话头部入口 → 面板五 tab，五个页签均已截图（`docs/evidence/shots/`） |
| Kali 远程执行 | ✅ SSH transport 已实现并在真实主机往返验证（该机为 Ubuntu，非 Kali 镜像） |
| 真实靶场全流程 | ✅ 模型驱动、跨进程、经 SSH 在 VM 内对 docker DVWA 靶场跑通（`docs/evidence/lab-run.md`） |

完整逐项状态见 `docs/ACCEPTANCE.md`（20 ✅ / 1 🟡 / 0 ⬜）。

---

## 2. 环境要求

- **DSH Desktop `0.2.1-rc.5`** 或更高的兼容版本。
- **Node ≥ 20**。注意：本项目测试用 `vitest@4`，在 **Node 21 上启动即崩**（`util.styleText` 不接受数组参数）；开发/测试请用 Node 22 或 24（可用 DSH 自带 bundled Node 24.21.0）。
- pnpm ≥ 9（`dsh plugin add` 内部使用 pnpm；本次验证环境为 pnpm 11.28.5）。
- Windows 为本机执行的默认与已验证平台（`cmd.exe` + `taskkill`）。Linux/macOS 的执行后端代码路径存在但**未实测**。

---

## 3. 安装

### 3.1 从本地目录安装（开发态，已实测）

```bash
# 先确保有构建产物（dsh 加载的是 lib/*.js，不是 src/）
cd /path/to/dsh-prism
npx tsc -p tsconfig.json

# 安装到某个 profile（建议先建独立 profile 验证，不要直接动日常 profile）
dsh plugin --profile prismverify add /绝对路径/dsh-prism
```

实测输出：
```text
$ dsh plugin --profile prismweb add <path-to-dsh-prism>
dependencies:
+ dsh-prism 0.1.0 <- <path-to-dsh-prism>
Done in 648ms using pnpm v11.28.5
```

CLI 会自动把声明了 `dsh.bundle` 的包追加到 `dsh.profile.bundles`，**不需要手改配置**：
```json
{ "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-prism"] } } }
```

### 3.1.1 真实 CLI 位置（不在 PATH 上）

本机安装目录下的启动器：
```text
<dsh-install>\resources\runtime\cli\bin\dsh.cmd
```

### 3.2 在运行中的 Desktop 里安装（已实测 `applied`）

若 Desktop 正在运行，通过「插件」面板（背后是 `pluginManager/installBundle`）传**绝对路径**安装，
它会返回实时 HMR 结果。实测输出（`docs/evidence/p9-applied.md`）：

```json
{"stage":"enable","target":"dsh-prism","enabled":true,"changed":true,
 "application":"applied","packageResult":{"exitCode":0,"output":"… Done in 589ms using pnpm v11.28.5"}}
```

注意两个真实行为：
- 已经装着的包再 `installBundle` 会返回 `application:"failed"` + `error.code:"already-installed"`
  ——覆盖安装要**先 remove 再 install**；
- 该 RPC 的 `args` 必须是**单个 plain object**（`{spec}` / `{name}`），传数组会被网关拒绝。

### 3.3 验证安装

```bash
# 组合配置里应出现三行：prism-host / preset-prism / preset-prism-worker
dsh --profile prismverify --dump-config | grep -A3 prism
```
```text
- id: prism-host
  name: dsh-prism
- id: preset-prism
  name: '@deepseek-ai/dsh-agent-preset'
    id: prism
    name: Prism 渗透模式
- id: preset-prism-worker
  name: '@deepseek-ai/dsh-agent-preset'
    id: prism-worker
```

启动后新建任务时，左下角预设选择器应出现 **「Prism 渗透模式」**：
```bash
dsh --profile prismverify --no-open
```

UI 侧还要确认两件事（`docs/evidence/p8-ui.md` 有实测输出）：
1. 页面 HTML 的 `__DSH_BOOT__` 里有
   `{"id":"dsh-prism","url":"plugins/??dsh-prism/client.js&rev=…","immediately":true}`；
2. 浏览器 console 没有 `slot entry crashed`。

> ⚠️ **headless 模板 profile 的已知差异**：headless 没有 `agentPresets` 服务，会出现
> `preset-prism ... pending (waiting for service: agentPresets)`。这是正常现象——请用含该服务的 web/desktop profile 验证。

---

## 4. 卸载

```bash
dsh plugin --profile prismverify remove dsh-prism
```
```text
dependencies:
- dsh-prism link:D:/.../dsh-prism
Done in 610ms using pnpm v11.28.5
```

卸载后 `bundles` 自动回到 `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]`，`--dump-config` 中无任何 Prism 行。

**数据不会被卸载删除**：`.prism/` 位于你的**工作目录**，与插件安装无关。要彻底清理某次 engagement，手动删除该项目下的 `.prism/`。

---

## 4.5 界面：Prism 面板从哪进

- **入口**：Prism 会话的**会话头部右侧**出现一个 `Prism` 按钮 —— 只有在
  「该会话 preset = `prism`」**且**「工作目录里存在 `.prism/` engagement」时才渲染；
  两个条件任一不满足时组件返回 `null`，**不产生任何可见界面**（普通编码/PPT 会话完全看不到）。
- **面板**：点开后是一个覆盖层面板，内部五个页签：**图谱 / 前沿 / 工兵 / 证据 / 报告**，
  全部只读 `.prism/`，每 4 秒刷新一次（仅在面板打开且页面可见时）。
- 数据来自 `GET /prism/view?view=<name>&session=<id>`（同源只读，见 `src/host/webrow.ts`）；
  该路由**只接受 session id，不接受任何路径参数**。

## 5. 使用：两种角色，两套工具面

安装带来两个 preset，**工具面互斥**——隔离靠组合而非运行时开关：

| | `prism`（Prism 渗透模式） | `prism-worker`（工兵） |
|---|---|---|
| 角色 | 指挥官 | 执行者 |
| 工具 | `prism_board` `prism_init` `prism_reason` `prism_hint` `prism_spawn` `prism_peek` `prism_msg` `prism_kill` `prism_verify` `prism_capabilities` `prism_tighten` | `prism_worker_report` `prism_exec_start` `prism_exec_output` `prism_exec_stop` `prism_run` + 宿主 bash/pwsh/fs/fs-search |
| **没有** | shell / fs / web / MCP —— 一个执行工具都没有 | ask-user / goal / todo / subagent —— 不能自己派单、不能向用户提问 |
| 强制 | `tools.guard()` 在执行前二次拦截任何执行类工具 | 无绑定 Assignment 时任何执行直接拒绝 |

### 典型推进流程
```text
prism_init            # 建立 engagement，由宿主审批后铸造 Mandate（模型无法自己提权）
prism_reason          # 读事实 → 写出候选 Intent
prism_spawn           # 派单给工兵（立即返回，不阻塞）
  └─ worker: prism_exec_start → prism_exec_output(游标轮询) → prism_exec_stop
  └─ worker: prism_worker_report  # 结构化回报：progress/waiting/ready/blocked/failed
prism_board           # 事实回图后看 frontier
prism_msg / prism_kill# 纠偏 / 止损；接班用 resume_of
prism_verify          # 可选：独立复核
```

---

## 6. 恢复语义

`.prism/` 是唯一权威存储（一文件一节点，原子写：临时文件 → fsync → rename），重启后不依赖旧聊天：

| 崩溃时的状态 | 恢复后 | 能否自动继续 |
|---|---|---|
| `Assignment.status = running` | → `interrupted`，并计入 `resumable` | ✅ 可续：新建 Assignment 带 `resume_of` |
| `Effect.status = pending` | 保留在 outbox | ✅ 下次 `drain()` 执行 |
| `Effect.status = unknown`（结果不明） | 进 `review_required` | ❌ **禁止自动重放**，必须人工核查 |
| `Effect.status = failed`（幂等执行器抛错） | 保持 `failed` | ❌ 需显式 `retry()` |

**同一 `dedupe_key` 的事件只会路由一次**：重复入站仍持久化（留痕），但不会重复派单。

---

## 7. 授权与安全

- **Mandate 不可变**：`{ scope: { targets[], actions[], backends[] }, strength: 'read'|'confirm'|'write'|'exploit' }`。撤销写独立的 `mandate_revocations/` 记录，并把受影响的活动 Assignment 置 `paused`。
- **模型不能文本提权**：范围/目标/后端/强度全部在 `PrismEngine.authorize()` 里判定，提示词怎么写都越不过去。
- **默认拒绝**：`classifyCommand()` 把未知命令一律归为 `requires_confirm: true`；无审批通道时 `denyAllApprovals` 一律拒绝（fail-closed）。
- **凭据脱敏**：进程输出与投影结果返回前经 `redactSecrets()`。
- **目标内容是数据不是指令**：注入给 worker/指挥官时用 `<<UNTRUSTED_DATA>> ... <<END_UNTRUSTED_DATA>>` 包裹，并转义伪造的闭合标记、剥离控制字符与 bidi 覆盖、HTML 转义。

### Kali / 远程执行（可选，默认关闭）

未配置远程完全不影响本机模式与启动。配置了但连不上，`healthCheck()` 返回 `verified: false`
并带上 ssh 自己的诊断，`start()` 出来的 handle 在 `output()` 里落 `status:"failed"`——
**绝不返回模拟成功**。

远程通道用**系统 OpenSSH 客户端**（`src/exec/ssh.ts`，零运行时依赖）：

- `BatchMode=yes`（不弹密码）、`StrictHostKeyChecking=yes`（仅 lab VM 可显式关）；
- 目的地与命令是两个独立 argv，`--` 结束选项解析，host/user 过白名单正则 —— 主机名无法变成 ssh 选项；
- 超时 `SIGKILL`，退出码记 `null`；`stop()` 只标状态，不 kill 远端进程（已知边界）。

配置写在 preset 行的 `config.kali`（`src/host/config.ts` 防御式解析，缺 `host` 即不启用）：

```yaml
- id: prism-worker          # commander 行（presets/prism.patch.yml）同形
  name: 'dsh-prism/worker'
  config:
    kali:
      host: 192.0.2.10
      user: user
      identityFile: C:/Users/you/.ssh/id_ed25519   # 密钥路径，不是密钥内容
      connectTimeoutSec: 8                         # 1–600
      strictHostKeyChecking: false                 # 仅 lab VM
```

真实往返证据见 `docs/evidence/p7-kali.md`（`verified:true`、`nmap` 真输出、`exit=127`、不可达 `exit=255`）。
⚠️ 验证主机是 **Ubuntu 22.04**，不是 Kali 镜像；`identityRef` → 密钥路径仍未接 `ctx.credentials`。

---

## 8. 未实现 / 未验证清单

> 按诚实原则，以下项**没有被写成已完成**。已经闭环的项从本清单移除，但证据留在
> `docs/evidence/`：面板像素（`p8-ui.md` §8）、`application: applied` 与覆盖安装（`p9-applied.md`）、
> SSH 真实联通（`p7-kali.md`）、**模型驱动的跨进程派单**（`lab-run.md`，真实靶场上跑通）都已销项。

1. **⚠️ mandate 的 `targets` 不约束实际命令。** `authorize()` 只在调用方显式传 `target` 时校验，
   而 `execStart` 从不传；`actions`/`backends` 是硬约束，`targets` 目前是**声明性**的。
   要做实需要在执行前从命令里解析目标，属设计改动（`docs/evidence/lab-run.md` §5 第 2 条）。
2. **⚠️ 执行记录不含命令原文。** `ExecutionRecord` 有 `job_ref`/`result`/`side_effect`，
   但没有 `command`，审计时无法从引擎侧还原"哪条命令产生了哪条记录"（同上 §5 第 1 条）。
3. **⚠️ 事实没有去重/合并。** 同一结论被多次观测会产生多条 fact（靶场跑里出现了 f013/f014 与 f008–f010 重复）。
4. **⚠️ `ctx.credentials` 引用式取凭据未接入**。当前靠输出脱敏 + 不落盘兜底；
   `kali.identityFile` 要用户自己填密钥**路径**，没有走宿主的凭据服务。
5. **⚠️ Kali 镜像本体未实测**。SSH 通道已在 Ubuntu 上真机验证（D23），但目标机是不是 Kali 未测。
6. **⚠️ Linux / macOS 本机执行后端未实测**（仅 Windows 路径验证）。
7. **⚠️ Watchdog 无自动触发源**。`src/runtime/watchdog.ts` 的四操作与准入检查已实现并测试，但"谁在何时调用 `scan()`"尚未接入事件流。
8. **⚠️ 护栏阈值未独立成模块**。原计划的 `runtime/guardrails.ts`（maxAutoTurns=40 / cooldown / human-reset）未拆出；轮询抑制由 fast path 的设计本身保证（无定时器），但自动轮次上限未实现。
9. **⚠️ 五视图的数据通道不是 `@Remote`**。用的是同源只读 HTTP 路由（typert codegen 只在 DSH monorepo 的 `build:lib` 里）。视图契约独立于通道，将来可平移（D22）。
10. **⚠️ 客户端 bundle 为手写纯 JS，无类型检查**。有 8 项契约测试，但没有 TS 类型约束。
11. **⚠️ `config.kali` 必须写在 preset patch 行里**，等于复制一份 bundle 改配置；尚未做成用户级设置项。
12. **⚠️ 覆盖安装只测了「同路径 remove + install」**，没有构造跨版本 diff 的升级场景。

---

## 9. 数据模型速查

```text
<cwd>/.prism/
├── project.json          # { id:'proj', schema_version, origin, authorization, goal, status, counters{12 类}, ... }
├── facts/{goal,fNNN}.json        # 不可变
├── intents/iNNN.json             # { description, from[], to|null, confirm, approved, claimed_by, backend, stop_condition }
├── mandates/mNNN.json            # 不可变
├── mandate_revocations/mdNNN.json
├── assignments/aNNN.json         # { intent_id, mandate_id, backend, worker_session, status, attempts, resume_of }
├── reports/rNNN.json             # { assignment_id, kind, text, facts[], evidence[] }
├── events/vNNN.json              # { source, dedupe_key, owner_session, status, filter_reason }
├── effects/xNNN.json             # Outbox: { kind, payload, status:'pending'|'done'|'failed'|'unknown', idempotent }
├── executions/xNNN.json          # { assignment_id, job_ref, status, output_cursor, side_effect, result }
├── hints/ workers/ messages/ evidence/
```

- `frontier` 判定：`ready ⟺ 开放 ∧ from 事实全存在 ∧ 未待确认 ∧ 未被 claim`——**状态完全由图结构推导**，无冗余 status 镜像。
- `schema_version` 由 `src/domain/migrate.ts` 显式升版，旧 `project.json` 自动补齐且幂等。

---

## 10. 开发

```bash
npx tsc -p tsconfig.json --noEmit    # 类型检查
npx tsc -p tsconfig.json             # 构建 lib/
npx vitest run                       # 全量：23 files / 187 tests
npx vitest run tests/host            # 单目录
```

约束：TS ESM（相对导入必须带 `.js`）、两空格单引号无分号、**不 import 任何 `@deepseek-ai/*`**、`src/x/y.ts ↔ tests/x/y.spec.ts` 镜像。

---

## 11. 文档

| 文件 | 内容 |
|---|---|
| `docs/SPEC.md` | 单一事实源（产品边界 / 领域模型 / 验收） |
| `docs/ARCHITECTURE.md` | 实际模块布局、数据模型、运行时、执行后端、投影 |
| `docs/DECISIONS.md` | ADR D1–D24（含 D16 零依赖、D17 预设走 patch 行、D20→D22 UI 落地、D21→D23 `applied` 销项、D23 SSH transport、D24 模板变量封闭集） |
| `docs/PLAN.md` | P0–P9 计划 + **实际落地对照**（逐条标注偏离） |
| `docs/ACCEPTANCE.md` | A1–A12 / N1–N9 逐项状态与证据映射 |
| `docs/STATUS.md` | 活状态板（接手先读） |
| `docs/DEVLOG.md` | 追加式时间线（含 RED 证据与事故复盘） |
| `docs/MECHANISMS.md` | 机制说明 |
| `docs/evidence/` | 真实命令 + 退出码 + 输出摘要 |
