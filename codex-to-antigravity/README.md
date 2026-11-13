# Codex → Antigravity · 开发版

从 Codex 把子任务交给原生 Antigravity Desktop，目标为 Hydrogen High。主控继续负责审查和整合。

在整个项目根目录按主 README 配置专用项目，然后运行 `./scripts/install.sh codex`。重新加载后使用 MCP 服务 `codex_to_antigravity_dev`。每次提交都传当前真实 CODEX_THREAD_ID；同聊天保留一个目标会话，不串到别的来源。

任务异步返回 ID；通过 ag_get_result 主动查询。没有外部唤醒功能。原生运行中取消需要到 Antigravity 操作。完整安装说明和开发限制见上级 README。
