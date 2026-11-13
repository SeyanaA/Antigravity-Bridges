# 环境调查（2026-11-13）

| 项目 | 实际结果 |
|---|---|
| 本机 | macOS Apple Silicon；Node.js 26.8.2 |
| Antigravity Desktop | `/Applications/Antigravity.app`，2.29.0 |
| 原生入口 | 官方 language_server 的 `agentapi`：new-conversation、send-message、get-conversation-metadata |
| 安全连接 | 官方 Sidecar 注入地址和 CSRF；桥接器不读取进程参数获取凭据 |
| 模型 | 官方 CLI 目录存在 gemini-4-hydrogen-high；原生会话界面已核对 Gemini 4 Hydrogen High |
| 档位选择 | 用户由 MAX 调整为 High；没有把 MAX 映射为 XHigh |
| 原生响应读取 | metadata 没有最终答复；使用任务专属 MCP 回传 |
| 原生取消 | agentapi 没有对应命令，未声称支持 |
| 官方 CLI | 本项目隔离安装 agy 1.5.7；官方安装器校验通过，未加入全局 PATH |
| CLI 运行任务 | 适配器已实现；没有用真实模型做 CLI 端到端测试 |
| DSH Desktop | 保留现有 Host 和持久会话映射；新增插件工具已经实际调用成功 |
| 原有 Codex↔DSH | 配置保留，无替换；原 Crew Hub 继续保持原有停用状态 |
| 新服务 | 127.0.0.1:3092；不是 DSH Web 的 3080 端口 |
| Codex 配置 | 新增 codex_to_antigravity_dev，不覆盖原 MCP |
| Antigravity 配置 | 增加本项目 Sidecar 及专门 reporter，保留其他设置 |
| 其他平台 | Windows 未验证 |

依赖通过 npm 安装并锁定。安装过程只备份、增量写入配置。官方 CLI 安装器曾自动增加 shell PATH 行，已经备份并移除本次增加的精确行，未保留全局 PATH 改动。
