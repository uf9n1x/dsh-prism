# 已知边界与常见问题

以下为**尚未实现或尚未验证**的项目，如实列出，不包装为已完成。

## 1. 已知边界

1. **命令中无法解析出端点时不做目标校验**：`whoami`、`cat /etc/passwd` 等不产生端点，约束它们的是 `actions` 而非 `targets`。
2. **回环地址恒在范围内**：`127.0.0.1 / localhost / ::1 / 0.0.0.0` 视为本机，不受 targets 约束。
3. **事实去重仅识别完全相同的 `title+summary`**：换一种表述的同一结论仍会产生新 fact。
4. **同一 `.prism/` 不支持多进程并发写**：同进程内以"每 root 只恢复一次"兜底，跨进程无租约。
5. **Kali 镜像本体未实测**：SSH 通道已在 Ubuntu 主机真机验证，但目标机是否为 Kali 未测。
6. **Linux / macOS 本机执行后端未实测**（仅验证 Windows 路径）。
7. **非 Prism 会话亦会看到「Prism」页签**：`conversation.view` 注册项无法按会话隐藏，点开为空态说明。
8. **客户端为手写纯 JS，无类型检查**：具备契约测试，但无 TS 类型约束。

## 2. 常见问题（安装 / 运行）

- **重复安装**返回 `already-installed`：覆盖安装需先卸载再安装。
- **`ERR_PNPM_UNEXPECTED_STORE`**：该 profile 的 `node_modules` 由旧版 pnpm 链接，与 DSH 自带 pnpm 的新 store 不兼容（安装任意插件均可能遇到，与 Prism 无关）。请完全退出 DSH 后，在外部终端以与 DSH 同版本的 pnpm 对该 profile 执行一次 `install` 重新链接。
- **headless / ACP profile** 出现 `preset-prism ... pending (waiting for service: agentPresets)`：属正常现象，请使用包含 `agentPresets` / `webServer` 服务的 web / desktop profile。

## 3. 环境要求

- DSH Desktop `0.2.1-rc.5` 或更高兼容版本。
- Node ≥ 20（仅**构建**需要；运行由 DSH 宿主提供）。`vitest@4` 在 Node 21 上启动即崩，请使用 Node 22 或 24。
- Windows 为已验证平台；Linux / macOS 执行后端代码路径存在但未实测。
