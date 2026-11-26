# DR: 接管官方新建工作树入口、支持留空随机分支与会话内切换工作目录模式

Status: implemented

## Problem

DSH 官方 `forge-bundle` 在空白会话右上角提供了默认的新建工作树控件（`conversation.hero.options` 的 `forge-panel.worktree`），与本插件左下角分支驾驶舱并列展示两个当前分支入口，造成视觉冗余与操作割裂。与此同时，两种工作树心智模型各有优势：

1. **独立工作区模式（本插件既有模式）**：每个工作树注册为独立 Workspace，适合多会话长期并行开发，但会增加侧边栏工作区条目。
2. **共享工作区模式（官方会话切换目录机制）**：不新增侧边栏 Workspace，而是直接在所属仓库 Workspace 下通过宿主 `ctx.workingDirectory.set` 将空白会话的工作目录切到工作树目录，轻量无冗余，且右侧文件树、终端和环境面板自动跟随。

此外，用户快速隔离实验性改动时并不总想手写分支名，但现有切出工作树弹层要求必须先输入非空分支名。

## Decision

围绕“本地 Git 工作台”定位，在不破坏既有独立工作区用户习惯的前提下落地四项能力：

1. **接管官方右上角新建工作树入口（`hideOfficialWorktreeEntry`，默认 `true`）**
   - 在插件配置中新增 `.volatile()` 开关 `hideOfficialWorktreeEntry`（默认开启）。
   - 开启时，客户端向 `conversation.hero.options` 注册同 `id: 'forge-panel.worktree'`、更高覆盖优先级 `priority: -10` 的空渲染组件，精准隐藏官方右上角按钮，完全保留右侧变更与评审面板；同时通过可选 `ctx.inject(['remote.forgePanel'], ...)` 在空白会话挂载与切换工作目录前幂等调用 `forgePanel.cancelWorktree(sessionId)`，清除复用空白会话上遗留的官方未决工作树请求，防止首轮对话时二次触发官方创建导致嵌套工作树与重复 `working-directory` 上下文注入。
   - 订阅 `SyncedConfig` 与 `configForms`，用户在插件设置页关闭该开关时立即卸载覆盖并恢复官方入口。

2. **留空即随机的切出分支交互**
   - `CreateWorktreeBody` 新增可选标志 `random?: boolean`，与 `cutout: true` 组合且未指定 `name` 时，Host 通过 `randomCutoutBranchName` 生成 `<baseLocal>-<4位随机十六进制>`（避开现有本地分支与已有工作树目录冲突），保留未传 `random` 时 `<base>-wt` 的兼容行为。
   - 在左下角分支菜单切出弹层中，输入框允许留空直接提交（留空即以随机分支名创建），占位文案直接说明留空自动随机，不增加多余的随机生成按钮；在侧边栏右键「新建工作树…」弹窗中，输入框为空时提供基于当前分支一键创建随机分支工作树的快捷行。

3. **会话内切换工作树目录模式（`switchSessionDirectory`，默认 `false`）与首消息延迟创建**
   - 在插件配置中新增 `.volatile()` 开关 `switchSessionDirectory`（默认关闭，确保升级后不强行改变老用户的独立工作区习惯）。
   - Host 侧通过可选注入 `ctx.inject(['agents', 'workingDirectory'], ...)` 桥接宿主服务，提供 `POST /plugin/git-worktree/session-cwd`（即时切目录）及延迟创建路由组（`GET /deferred`、`GET /deferred/events` SSE、`POST /deferred/arm`、`POST /deferred/action`），并在内存维护 `DeferredWorktreeCoordinator` 状态机监听 `agent/inbox/inserted`（通过 `agent.runMaintenance` 挂起首条消息执行完整建树管线并实时推送 `fetch`/`create`/`copy`/`switch` 阶段状态，失败支持 `retry` 重试或 `withdraw` 放行继续）与 `agent/pre-step`（`step === 1` 兜底并合并 `working-directory` 通知）。
   - 开启 `switchSessionDirectory` 后，客户端不再为工作树注册独立 Workspace，且按“新建延迟、复用即时”区分：
     - **新建/切出工作树（延迟创建）**：空白会话左下角触发时在当前空白会话就地武装，侧边栏主仓库右键触发时先在所属主仓库 Workspace 下通过 `ctx.sessions.create({ workspaceId })` 新建空白会话再武装并打开；未发首条消息前不创建分支也不写入磁盘，输入框上方 `conversation.input.dock` 展示待建条并支持随时取消；用户发送首条消息时才执行建树、展示进度卡片，完成后刷新 `workingDirectory` 投影与缓存并触发自动清理。
     - **复用/跳到已有工作树（即时切换与独立工作区优先归位）**：若目标目录已经存在独立 Workspace（含跳回主仓库本身），直接调用 `uiWorkspace.startSession` 打开该 Workspace（既不把同一工作树的会话拆散到侧边栏两个位置，也不在跳回主仓库时多余触发 `session-cwd`）；否则在 `switchSessionDirectory` 开启时切换当前空白会话目录，或在所属主仓库 Workspace 下优先复用已指向目标工作树的未归档空白会话，不存在时再新建空白会话并切换目录；侧边栏右键新建延迟工作树时，若主视图正停留在所属主仓库的未武装空白会话上，同样就地复用武装；切目录前自动撤销残留的官方请求与延迟武装。
     - 永不移动任何已开始会话的工作目录，已存在的独立工作区保持不动。

4. **全链路统一读取 `workingDirectory` 投影、工作树总管形态区分与官方工作树可选纳管**
   - 新增 `src/client/session-directory.ts`，按 DSH 官方优先级（live projection face → `projectionsBySession` → `byId.projectionValues.workingDirectory` → `byId.cwd` → 所属 Workspace 目录）解析会话真实目录，并计算每个工作树的接入形态（`standalone` 独立工作区 / `session` 会话目录 / `none` 无会话）。
   - 工作树总管（`WorktreeManagerModal`）在每行分支旁展示「独立工作区 / 会话目录」形态标签，并新增 `.volatile()` 开关 `manageOfficialWorktrees`（默认关闭）：开启后一并扫描 `<repo>/.agents/worktrees` 并以「DSH 官方」分组展示，支持查看、打开与手动删除，但始终排除在自动清理（`autoPruneWorktrees`）范围之外。
   - `BranchChip`、`WorkspaceGitCache` 同步源、原生右键菜单、工作树总管和自动清理统一消费真实会话目录，使两种模式与官方创建的工作树会话无缝共存。
   - 侧边栏工作树提示严格按归属层级区分：`sidebar.session.row.trailing` 与 `sidebar.session.row.hover` 仅在「父仓库工作区 + 会话内切换工作目录」的会话上展示（且让位给官方 `forgeWorktree` 投影），hover 复用官方两行样式（分支名 + `工作树 · 基于 {base}`，基分支持久化于 `<worktreeGitDir>/dsh-worktree-base`）；独立工作树工作区下的会话不再重复挂工作树提示（注：DSH 宿主当前仅开放会话行槽位，尚未在 `WorkspaceHoverContent` 暴露工作区级 hover 槽位）。
   - 删除工作树与自动清理时，按会话真实目录归属统计运行中状态、活跃时间与待归档会话；仅当存在 `workspace.path === worktreePath` 的独立 Workspace 时才删除该 Workspace，严禁误删主仓库 Workspace。

## Alternatives considered

- **用 CSS/DOM 隐藏官方右上角按钮**：脆弱且依赖内部 DOM 结构，卸载恢复不可控；DSH `ui-slots` 原生支持 `list` 插槽同 `id` 的 `priority` 覆盖，语义清晰且生命周期自动管理。
- **默认开启 `switchSessionDirectory`**：直接改变已有用户的侧边栏工作区组织习惯会造成升级割裂，因此默认保持 `false`，让用户按需开启。
- **复用 `uiWorkspace.connectWorkspace` 创建新会话**：`connectWorkspace` 会复用父 Workspace 下第一个未归档空白会话，可能意外覆盖已在其它工作树或含草稿的空白会话；直接调用 `ctx.sessions.create({ workspaceId })` 显式新建空白会话更安全。
- **直接复用官方 `ctx.worktrees.create`**：官方实现固定写入 `.agents/worktrees`，不支持 `.worktreeinclude` 环境文件继承、既有分支/远端追踪分支复用及跨仓管理，因此保留本插件的工作树创建管线，仅复用宿主 `ctx.workingDirectory.set` 切目录机制。

## Consequences

- **所得**：消除空白会话中官方与本插件的双入口冲突；同一套工作台同时兼容独立工作区与共享工作区两种心智模型；支持零输入快速随机隔离分支；侧边栏角标与右键菜单可准确识别通过目录切换进入的工作树会话。
- **代价**：客户端需要同时订阅 `sessions.list` 与 `workspaces.list` 以同步会话工作树目录缓存；若宿主未挂载 `workingDirectory`/`agents` 服务，开启会话目录切换模式时后端返回 501 并在客户端提示不支持。
