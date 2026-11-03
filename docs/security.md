# 安全与授权

Prism 面向**获得明确书面授权**的安全测试。安全不是提示词约束，而是由领域模型在每次执行前确定性判定。

## 1. 授权模型（Mandate）

- 每次 engagement 由 `prism_init` 铸造**不可变授权凭证（Mandate）**：`scope:{targets[], actions[], backends[]}` + `strength`（`read / confirm / write / exploit`）。
- 范围一经建立**只可收紧、不可放宽**：扩大范围必须产生新 Mandate；撤销经 `mandate_revocations/` 与 `prism_tighten` 记录。
- `intent.confirm` 或指挥官的自然语言判断**不是**授权依据；高风险动作（利用、凭据、目标写入、外发/提交）必须 confirm，无法分类时默认要求确认或拒绝。

## 2. 执行前强制校验

- **目标从命令行解析**：`execStart` 在启动进程前从命令行解析端点（URL host / IPv4 / CIDR / `user@host`），逐一比对 `targets`，越界即拒绝，进程不会启动，也不落 ExecutionRecord。
- **默认拒绝**：未知命令一律 `requires_confirm`；无审批通道时一律拒绝（fail-closed）。
- **收紧即暂停**：授权撤销或范围缩小时，受影响的 Assignment 立即置为 `paused`。
- **`prism_run` 不是通配符**：通用 run 授权只覆盖 read / scan / fetch 类动作，不覆盖写入与破坏性类别。

已知残余边界（命令解析不出端点时不校验目标、回环地址恒在范围内等）见 [known-limits.md](known-limits.md)。

## 3. 凭据与脱敏

- 凭据仅经宿主 `ctx.credentials` **引用**使用（如 `cred://lab-ssh-key`）；秘密值不进入 prompt / fact / evidence / 日志 / 界面。
- 进程输出与投影在返回前经 `redactSecrets()` 脱敏。

## 4. 不可信数据

目标返回的所有内容（网页、banner、文件、事件）都是**数据而非指令**：

- 注入指挥官 / 工兵上下文时以 `<<UNTRUSTED_DATA>> … <<END_UNTRUSTED_DATA>>` 包裹；
- 转义伪造的闭合标记，剥离控制字符与 bidi 覆盖字符。

## 5. 审批开关

默认 `preAuthorized: true`（常驻预授权、不弹审批，面向已确定授权的任务），范围检查不变。若在他人环境中使用，设 `config.preAuthorized: false` 恢复人工审批闸门。配置方法见 [usage.md](usage.md)。
