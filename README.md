# Prism — 授权红队 / 渗透模式（DSH Desktop 插件）

> ⚠️ **仅用于获得明确书面授权的安全测试、红队评估、CTF 与漏洞赏金。**
> 作者不对未授权使用负责。使用者须自行确认对目标拥有书面授权。

Prism 是 DSH Desktop 的一个**自包含 bundle**：注册 **「Prism 渗透模式」** agent preset，由**指挥官主 Agent**通过**事实—意图图**指挥**可替换的工兵子代理**，事件驱动自动推进授权渗透任务。所有结论、证据、状态、交接持久化在会话工作目录的 `.prism/` 下，可断点恢复。**默认 Windows 本机运行，不依赖 Docker / Kali。**

---

## 1. 交付状态

| 项 | 状态 |
|---|---|
| 源码 + 测试 | ✅ `src/` **31** 个 TS 文件；`tests/` **18 文件 / 116 项全绿** |
| 构建 | ✅ `npx tsc -p tsconfig.json` → exit 0，产出 `lib/` |
| 真实安装 | ✅ 独立 profile 上 `dsh plugin add` 成功，页面出现「Prism 渗透模式」 |
| 真实卸载 | ✅ `plugin remove` 后 bundle 清单与配置零 Prism 行 |
| 五视图 UI | ❌ **未实现**（见 §8 第 1 条） |
| `application: applied` | ⚠️ **未取得**（CLI 安装语义为 restart-required，见 §8 第 2 条） |
| Kali 真实联通 | ⚠️ **未验证**（标 `unverified`，见 §8 第 3 条） |

完整逐项状态见 `docs/ACCEPTANCE.md`（15 ✅ / 4 🟡 / 1 ⬜）。

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

### 3.2 在运行中的 Desktop 里安装（未取得 `applied`）

若 Desktop 正在运行，应通过 `plugin_manager install_bundle` 传**绝对路径**安装，它会返回实时 HMR 结果（期望 `application: applied`）。本仓库**尚未**在运行态复验这一项（见 §8）。

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

### Kali（可选，当前 `unverified`）
未配置 Kali 完全不影响本机模式与启动。配置了但无 transport、或 transport 抛错，`healthCheck()` 一律返回 `verified: false` 且 `start()` 抛错——**绝不返回模拟成功**。

```ts
// 接线点：src/exec/kali.ts 的 KaliTransport
new KaliBackend({ transport: 'ssh' | 'mcp', host, port, auth })
```
真实的 MCP/SSH transport 本仓库**未提供实现**，需自行注入。

---

## 8. 未实现 / 未验证清单

> 按诚实原则，以下项**没有被写成已完成**。

1. **❌ 五视图 UI 完全未实现**（Graph / Frontier / Workers / Evidence / Report）。
   已交付的只有 Host 侧只读投影 `src/projection/readmodel.ts`（board/workers/evidence/report，均有测试）。
   缺 `src/projection/remote.ts`（`@Remote` 声明）与 `src/client/*`。阻塞原因：DSH 的 Remote 需要 **typert codegen**，本仓库没有该工具链。
   **因此 `package.json` 故意不声明 `dsh.client`**——无 client bundle 却声明会让 web boot 失败。`tests/bundle.spec.ts` 有一条守护断言锁住这一点。
2. **⚠️ `application: applied` 未取得**。该项由 `plugin_manager` 工具的实时 HMR 返回；本次通过 `dsh plugin add` 在**未运行**的 profile 上安装，只可能得到 restart-required 语义。需在运行中的 Desktop 上复验。
3. **⚠️ Kali 真实联通未验证**。仅有契约测试（5 项）与 `verified:false` 行为保证。
4. **⚠️ 真实模型驱动的子代理派单未跑通**。`dispatch → startActivation → worker 执行 → subagent/end → 唤醒` 的完整跨进程链路需要 LLM 凭证与运行态会话；当前在 `NativeOps` 注入层（stub）上证明。
5. **⚠️ `ctx.credentials` 引用式取凭据未接入**。当前靠输出脱敏 + 不落盘兜底，尚无语义化的凭据引用。
6. **⚠️ 升级路径未实测**（旧 bundle → 新 bundle 覆盖安装）。
7. **⚠️ Linux / macOS 执行后端未实测**（仅 Windows 路径验证）。
8. **⚠️ Watchdog 无自动触发源**。`src/runtime/watchdog.ts` 的四操作与准入检查已实现并测试，但"谁在何时调用 `scan()`"尚未接入事件流——需外部调度或后续阶段补齐。
9. **⚠️ 护栏阈值未独立成模块**。原计划的 `runtime/guardrails.ts`（maxAutoTurns=40 / cooldown / human-reset）未拆出；轮询抑制由 fast path 的设计本身保证（无定时器），但自动轮次上限未实现。

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
npx vitest run                       # 全量：18 files / 116 tests
npx vitest run tests/host            # 单目录
```

约束：TS ESM（相对导入必须带 `.js`）、两空格单引号无分号、**不 import 任何 `@deepseek-ai/*`**、`src/x/y.ts ↔ tests/x/y.spec.ts` 镜像。

---

## 11. 文档

| 文件 | 内容 |
|---|---|
| `docs/SPEC.md` | 单一事实源（产品边界 / 领域模型 / 验收） |
| `docs/ARCHITECTURE.md` | 实际模块布局、数据模型、运行时、执行后端、投影 |
| `docs/DECISIONS.md` | ADR D1–D21（含 D16 零依赖、D17 预设走 patch 行、D20 UI 未交付、D21 安装证据口径） |
| `docs/PLAN.md` | P0–P9 计划 + **实际落地对照**（逐条标注偏离） |
| `docs/ACCEPTANCE.md` | A1–A12 / N1–N9 逐项状态与证据映射 |
| `docs/STATUS.md` | 活状态板（接手先读） |
| `docs/DEVLOG.md` | 追加式时间线（含 RED 证据与事故复盘） |
| `docs/MECHANISMS.md` | 机制说明 |
| `docs/evidence/` | 真实命令 + 退出码 + 输出摘要 |
