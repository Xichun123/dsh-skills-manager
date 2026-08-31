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

- 私有安装库位于 `$DSH_HOME/skill-manager/.agents/skills`，CLI 来源锁位于 `skills-lock.json`，状态位于 `$DSH_HOME/skill-manager/state.json`。
- Host 以私有 storage 为 cwd 调用 packaged `skills` CLI；它负责本地/Git 发现、复制、来源锁和刷新，插件不重做 Git 内容处理或临时替换事务。调用前只保留必要的来源 symlink 根目录校验，Git 来源为此做一次浅克隆预检。
- `skills-lock.json` 是唯一来源记录；插件 `state.json` 只保留启用范围与「仅手动」覆盖，不重复保存来源信息。
- Git 支持 GitHub `owner/repo`、HTTPS、SSH、Git 与 file URL；私有仓库复用本机 Git credential helper 或 SSH，拒绝 URL 内嵌凭据且不保存 token。
- 新导入 skill 默认关闭；仅接受目录型 `<name>/SKILL.md`。全局启用会对所有 cwd 生效，项目启用会对所选工作区及其子目录生效。
- Provider 复用 `@deepseek-ai/dsh-skill-filesystem` 的解析、资源和 watcher 能力，只过滤由本插件管理的库条目。
- 「仅手动」由 provider 解析 invocation 策略时决定：`state.json` 的覆盖优先于 frontmatter `disable-model-invocation`，list 与 get 两条路径同时套用，因此不改写 `SKILL.md`，更新与重装也不会丢设置；没有覆盖条目时完全跟随文件声明。
- 一键更新检测按来源分组；不同来源的浅克隆以及同一来源内各 skill 的内容哈希并发执行，且检测过程不修改已安装内容。
- 设置页使用 `settings.section` 作为左侧一级入口；输入框 `+` 右边的扳手图标控件打开当前会话 cwd 的项目级开关。
- RPC 仅注册 loopback authority，因为导入和持久化操作会触碰本机文件系统。
