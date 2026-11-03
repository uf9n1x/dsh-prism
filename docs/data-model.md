# 数据模型（`.prism/`）

Prism 的全部领域状态落在**会话工作目录**下的 `<cwd>/.prism/`，一文件一节点。`PrismEngine` 是唯一写入口；UI 与工具读到的都是只读投影。

## 1. 目录结构

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

## 2. 写保证

- **原子写**：临时文件 → fsync → rename，进程崩溃不会留下半写节点。
- **跨平台目录锁**：同一 `.prism/` 的并发写由目录锁串行化（同进程内以"每 root 只恢复一次"兜底；跨进程多写者不受支持，见已知边界）。
- **zod 校验**：每次读取与写入都经 schema 校验，损坏文件在投影层显式报错而不是带病展示。

## 3. 前沿（frontier）判定

见 `src/graph/frontier.ts`，全部由结构推导：

- `done` = 已闭环（`to !== null`）；
- `running` = 开放且被认领（`claimed_by !== null`）；
- `ready` / `available` = 开放 ∧ 未被认领 ∧ `from` 事实全存在 ∧（无需确认或已批准）；
- `blocked` = 其余（缺前置事实或待确认）。

状态完全由图结构推导，**不设冗余状态镜像**（Assignment / Execution 例外：二者本就记录执行尝试状态）。

## 4. 不变量

- **不可变**：fact 与 mandate 同 ID 二次写入被拒绝；更正以新节点与关系表达。
- **引用完整性**：`from / to / evidence / claimed_by / mandate_id / assignment_id / intent_id` 必须指向存在实体，否则写入被拒。
- **schema 迁移**：`project.json` 携带 `schema_version`，旧版本经 `src/domain/migrate.ts` 显式升级后再校验。
