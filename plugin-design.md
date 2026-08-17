# Plugin Design

## 形态决策

- 目标：在 DeepSeek Harness 中统一管理可安装 skill，并按全局或工作区启用。
- 做插件：是。
- 树外 / first-party：树外独立 npm 包 `dsh-skills-manager`。
- 形态：Host skill provider + Host RPC + Client Settings UI。
- 挂载点：`ctx.skills.registerProvider()`、`ctx.connection.rpc.handle('/skill-manager', ...)`、`settings.section`、`conversation.input.left`。
- 不选其他形态的原因：不是 Agent Skill 文件本身，也不需要改 agent-loop、注册新工具或替代 MCP；只需要改变 skill 的发现范围并提供管理界面。
- 拆 seam：否。管理状态、provider 和 RPC 是同一产品能力，暂不拆成多个包。

## 行为

- 安装库位于 `$DSH_HOME/skill-manager/library`，状态位于 `$DSH_HOME/skill-manager/state.json`。
- 导入 skill 时复制完整目录，因此 `references/`、`scripts/`、`assets/` 等伴随资源保留。
- 安装状态记录本机来源路径，或 Git 仓库 URL 与仓库内 skill 子路径，并保存完整内容哈希；检查更新时重新读取本机来源或浅克隆仓库比较哈希，更新通过临时副本和备份原子替换，并保留启用范围。
- Git 支持 GitHub `owner/repo`、HTTPS、SSH、Git 与 file URL；私有仓库复用本机 Git credential helper 或 SSH，拒绝 URL 内嵌凭据且不保存 token。
- 新导入 skill 默认关闭；全局启用会对所有 cwd 生效，项目启用会对所选工作区及其子目录生效。
- Provider 复用 `@deepseek-ai/dsh-skill-filesystem` 的解析、资源和 watcher 能力，只过滤由本插件管理的库条目。
- 设置页使用 `settings.section` 作为左侧一级入口；输入框 `+` 右边的扳手图标控件打开当前会话 cwd 的项目级开关。
- RPC 仅注册 loopback authority，因为导入和持久化操作会触碰本机文件系统。
