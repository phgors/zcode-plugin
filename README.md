# phgors-zcode-plugin

个人的 ZCode 插件：无人值守工单驱动技能 + 会话启动时自动注入 `AGENTS.local.md` 的钩子。

## 内容

| 组件 | 说明 |
|---|---|
| `unattended` 技能 | 无人值守驱动者模式：主会话只做观察者，逐张 spawn 后台代理完成工单集 |
| `unattended-workflow` 技能 | 工作流引擎版无人值守：一个 dynamic-workflow 后台运行，支持指定子代理模型、实时看板、运行前确认 |
| `load-agents-local` 钩子 | SessionStart（startup/resume）时读取项目根的 git-ignored `AGENTS.local.md` 并注入会话上下文，作为最高优先级的项目覆盖指令 |

## 安装（本地市场测试）

仓库根本身即一个插件市场（`marketplace.json` 在根，`source: "./"`）：

1. 打开 **Plugin Marketplace → Add → Add Plugin Marketplace**；
2. 粘贴本仓库的本地目录路径（或 GitHub 仓库地址，视客户端支持而定）并添加；
3. 在 **Personal** 下找到 `phgors-zcode-plugin` 点 **Install**。

从 GitHub 使用时克隆或下载本仓库到任意目录，按同样方式添加该目录即可。

## 钩子行为

`hooks/load-agents-local.sh` 在会话启动/恢复时运行：

- 项目根定位：`CLAUDE_PROJECT_ROOT` 环境变量 → hook 输入 JSON 的 `cwd` 字段（含 Windows 路径反斜杠转义还原）→ 当前目录；
- 项目根存在 `AGENTS.local.md` 时把内容注入上下文；不存在时静默退出；
- 通过 `${CLAUDE_PLUGIN_ROOT}` 引用插件安装路径，不含任何写死的本机路径。

## 更新

修改源码后递增 `.zcode-plugin/plugin.json` 与 `marketplace.json` 里的 `version`，在市场里刷新并重装插件即可。
