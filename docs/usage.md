# 使用与配置

## 1. 快速上手

1. **新建任务**，预设选择 **「Prism 渗透模式」**。
2. **一句话说清目标、授权与预期范围**，例如：
   - `已获授权测试 CTF 靶机 192.0.2.20（http://192.0.2.20/），先进行端口与服务侦察，再定位可利用点。`
   - `对本地 DVWA 192.0.2.30:8080 进行授权测试，已知 admin 凭据，先侦察再尝试登录。`
3. 指挥官随后自动初始化、编写待办、派发工兵；任务在后台推进，可在对话中继续纠偏、暂停或调整方向。
4. 打开会话页签 **「Prism」**，查看 图谱 / 前沿 / 工兵 / 证据 / 报告。

> **授权级别最关键**：默认 `strength: read`，仅覆盖侦察。若需写入、漏洞利用或获取 shell，请在开始时明确说明"允许 exploit / 写入"，指挥官初始化 Mandate 时会带上相应 `actions` 与 `strength`。详见 [security.md](security.md)。

## 2. 恢复

任务状态完整保存在 `<工作目录>/.prism/`，重启后指挥官读取 `prism_board` 续跑；被中断的工兵可经 `prism_spawn ... resume_of` 接手。数据与插件安装无关，卸载插件不会删除 engagement 数据。

## 3. 配置

全部配置写在对应 preset 行的 `config` 中，安装后无需改动。

### 3.1 Kali / 远程执行（可选，默认不启用）

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

### 3.2 审批开关

默认 `preAuthorized: true`。面向已确定授权的任务；在他人环境中使用请设为 `false` 恢复人工审批。

## 4. 卸载

于插件面板卸载，或 `dsh plugin --profile desktop remove dsh-prism`。`.prism/` 数据不会被删除；如需彻底清理某次 engagement，手动删除会话工作目录下的 `.prism/`。
