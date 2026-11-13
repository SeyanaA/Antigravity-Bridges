# Antigravity 双入口桥接器 · 开发版

让 Codex 或 DSH Desktop 把独立子任务交给 **Antigravity Desktop**，在原生窗口中查看过程，再把结果取回。两个入口共享一套任务服务，但分别保存会话对应关系，不会把 Codex 和 DSH 的任务续进同一个窗口。

[下载开发版](https://github.com/SeyanaA/Antigravity-Bridges/releases/tag/v0.1.0-dev.1) · [测试报告](docs/test-report.md)

本版固定目标为 **Gemini 4 Hydrogen / High**（`gemini-4-hydrogen-high`）。不会自动换模型。DSH 自己使用什么模型仍由原有 DSH 设置决定。

## 已经做到什么

- **Codex → Antigravity**：通过 MCP 提交、查询、查看事件和读取回传结果。
- **DSH → Antigravity**：DSH Desktop 插件提供 `antigravity_submit_task` 等工具；自动使用真实 DSH 会话 ID。
- 第一次提交创建原生 Antigravity 会话；同一来源会话、同一工作目录的后续任务继续该会话。不同来源、不同聊天分别保存。
- 提交立即返回任务 ID；SQLite 保存状态和会话对应关系；同目录任务排队执行。
- Antigravity 中的执行 Agent 用专门的 `ag_report_result` 工具回传结果。按需加载的工具需要先搜索发现，桥接提示已包含这一步。
- 本地监控页显示真实任务、状态、来源、目标模型、事件和返回内容。

2026-11-13 已在这台 Mac 上完成两条入口的真实“你好”测试，并验证 Codex 重启桥接服务后仍续接原会话。详见 [测试报告](docs/test-report.md)。这证明消息闭环；尚未证明大型开发任务或 Windows 环境可靠。

## 已验证的使用方式

开发机上的两条入口已经注册；其他机器请先完成下方安装。Antigravity 中打开 **Antigravity Bridge Dev** 项目查看原生对话；DSH 来源测试在 **desktop-smoke-workspace**。

监控地址：<http://127.0.0.1:3092/>。Codex 新注册的 MCP 名称是 `codex_to_antigravity_dev`；若当前聊天尚未发现新工具，重新加载连接后使用。开发期间可从当前 Codex 环境运行下方的 MCP 客户端助手，它连接同一套服务，不另起 Agent Runtime。

```sh
node scripts/task.mjs codex health
node scripts/task.mjs codex submit /absolute/path/task.txt
node scripts/task.mjs codex result ag-实际任务ID
node scripts/task.mjs codex events ag-实际任务ID
```

助手必须继承当前聊天真实的 `CODEX_THREAD_ID`，缺少时会拒绝提交。不要手工编造 ID。DSH Desktop 可直接调用 `antigravity_submit_task`，取得 ID 后用 `antigravity_get_result` 查询。调用者可以继续其他独立工作，再主动查询；桥接器不能从外部唤醒 Codex 或 DSH。

## 在另一台 Mac 上安装

需要 Git、Node.js 24 或更新版本，以及已安装并登录的 Antigravity Desktop；DSH 版还需要已安装的 DSH Desktop。安装包是**开发源码包**，不是 DMG，也不包含模型账号、登录信息或官方运行时。

1. 解压后保留整个目录，在 Antigravity 中创建一个专用项目，把本目录下的 `workspaces` 文件夹添加进去。从项目链接的 `project=` 后取得真实项目 ID。
2. 在该目录运行（将项目 ID 替换为自己的）：

   ```sh
   node scripts/configure.mjs 实际项目ID
   ./scripts/install.sh codex
   # 需要 DSH 入口时再运行：
   ./scripts/install.sh dsh
   ```

   两个入口共用同一目录安装最方便。标有单一入口的开发包，省略参数时默认安装对应入口；源项目省略参数时安装全部。

3. 配置步骤会给空白工作目录建立独立 Git 仓库，防止原生审查混入上层仓库；已有非空目录请自己准备隔离副本。安装会备份并增量修改各自的配置，保留原有 MCP、DSH 插件和 Antigravity 设置。Antigravity 的回传工具和 Sidecar 也一并注册。打开 Antigravity 的 Customizations → Installed，确认 `antigravity_bridge_reporter` 的 `ag_report_result` 已启用。
4. 若客户端没有重新加载配置，重新加载相关连接或在空闲时重开客户端。先运行 `./scripts/doctor.sh`，再发一条简短问候做真实验收。诊断本身不调用模型。

若 3092 已被占用，在 `config/local.json` 修改 `port` 后重启桥接服务；不会结束未知进程。安装脚本不会自动安装或修改现有 DSH/Antigravity 的版本，也不更改模型账号和权限预设。

## 日常查看与停止

```sh
./scripts/start.sh
./scripts/doctor.sh
./scripts/stop.sh
npm test
```

- 主进程日志：`data/service.log`；任务和事件保存在 `data/tasks.sqlite`，监控页可读。
- `stop.sh` 只停止桥接任务服务，不退出 DSH 或 Antigravity。原生 Sidecar 由 Antigravity 管理；若要停用它，在 Antigravity 的 Customizations 中关闭 **Antigravity Bridge Dev**。
- 有任务运行或原生执行状态不明时，停止服务会被拒绝。先到 Antigravity 检查并停止该任务；超时/中断任务确认结束后，调用 `ag_confirm_stopped`，再停止服务。
- 不要分享 `data`、`config/local.json` 或应用配置备份；它们包含本机任务内容和本地授权材料。发行包不包含这些目录。

## 使用边界

- **原生进度在 Antigravity 中看**。公开 `agentapi` 只有创建、发消息和元数据入口，没有完整步骤/最终回复读取接口，因此桥接页只展示自己确实收到的事件和回传。原生工具详情、文件和 diff 在 Antigravity 中审查，不会伪造到监控页。
- **正在运行的原生任务不能通过桥接 API 取消**。只能到 Antigravity 手动停止；排队任务可以取消。超时不表示原生执行已经结束，目录锁会保留。
- 服务重启会把未结束任务标为中断，不自动重跑。历史记录和会话对应关系保留。
- 原生回传依赖模型实际调用工具；没回传会超时，不把一句普通界面回复当成桥接成功。
- 专用工作目录是操作约定及提交校验，**不是文件系统沙箱**。原生 Agent 继承 Antigravity 当前权限。开发版不自动创建 Git worktree、不自动收集所有 diff、不自动合并。重要项目请先手工创建子目录 worktree/副本，并自行审查实际修改与命令结果。
- 同目录写任务串行；原生任务都在配置的项目里，因此**不承诺不同目录可获得操作系统级隔离或安全并行写入**。人工操作同一原生会话时，避免同时让桥接器提交任务。
- 已有会话不会因配置修改自动换模型；模型变化时拒绝续接并要求明确新建。分支聊天应传真实的新来源 ID，并由主控写必要的上下文交接。
- 缓存命中和 Token 用量没有可靠的原生读取接口，显示未知；不作费用或命中率保证。
- 目前在 macOS 验证；Windows 尚未验证。不要将本包当成 Windows 安装器。
- 另有显式 CLI 适配器，供后续开发使用；不会在 Desktop 失败时自动切过去。真实模型测试使用的是原生 Desktop，CLI 只进行了模拟进程测试。

## 程序组成

`core` 管任务、数据库和 MCP；`adapters/native-sidecar.mjs` 使用官方 Sidecar 注入的连接信息调用原生 `agentapi`，不抓取应用凭据；`adapters/reporter-mcp.mjs` 负责任务回传；`dsh-to-antigravity` 是 DSH 插件；`codex-to-antigravity` 是 Codex MCP 入口；`dashboard` 是本地监控页。

两条入口共用本机服务，身份按调用来源划分。本地授权不防御同一系统账号下的恶意进程；没有开放远程访问。任务回传口令仅用于指定任务，日志隐藏它，不代表模型的测试声明已被独立验证。最终验收仍由主控负责。

设计沿用 Codex-to-DSH Bridge 的“主控委派、保留会话、主动查询和审查”方式，本项目没有复制或替换 DSH Crew 的 Agent Runtime。主要代码由 Codex 实现；DSH Desktop 参与了来源端真实调用验证。

更多依据：[环境调查](docs/environment-report.md) · [架构选择](docs/architecture-decision.md) · [测试报告](docs/test-report.md)。
