# 选择原生 Sidecar + MCP 回传

使用官方维护的原生 Agent Runtime，不另造一个模型执行器。调用者的 MCP 或 DSH 原生工具负责提交到本机队列；Antigravity 管理的 Sidecar 调用 agentapi，在专用项目创建或续接真实会话。

原生元数据没有最终答复和完整运行步骤。为保持透明，进度继续在原生窗口查看，模型通过独立 reporter MCP 回传最终内容或问题。监控页只显示真实桥接事件及回传。工具可能按需加载，因此提示要求先搜索发现 ag_report_result。

任务对应关系由来源（Codex/DSH）、真实来源会话 ID、目录和后端共同确定；一次提交有一个任务 ID，一个来源聊天可顺序复用一个目标会话。显式独立会话不替换普通对应关系。队列把相同目录或会话对应关系的任务串行处理。

回传采用任务专属随机口令，同时要求 reporter 服务身份；调用方角色不能被请求参数改写。HTTP 只监听 127.0.0.1，校验 Host 和 Origin，页面采用同站 Cookie，返回数据用 textContent 渲染。Sidecar 不向调用方暴露 Antigravity 的连接凭据。任务口令并非用户模型账号凭据，只用于回传该任务。

原生 API 没有取消入口，因此运行中取消明确拒绝。超时和服务重启保留“执行未确认”的锁，等待用户检查；不自动重跑，不擅自退出原生应用。CLI 后端是显式实验选项，支持取消自己启动的进程；绝不自动作为原生失败后的替代。

本开发版只校验提交目录和提示中的文件范围，没有文件系统级隔离，没有自动合并；调用者仍须准备隔离副本并核验修改。

依据：[官方 Sidecars](https://antigravity.google/docs/sidecars)、[官方 CLI headless](https://antigravity.google/docs/cli/headless/)、[CLI reference](https://antigravity.google/docs/cli/reference/)。MCP 注册参照 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)，Antigravity MCP 配置也核对了本机随附的 agy-customizations 文档。
