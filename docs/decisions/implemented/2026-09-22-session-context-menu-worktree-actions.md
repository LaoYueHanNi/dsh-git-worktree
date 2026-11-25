# DR: 原生侧边栏右键菜单集成与工作树视觉标记

Status: implemented

## Problem

在 0.1.6 迁移废弃侧边栏整块遮蔽、回归原生 `ui-workspace` 后，用户在左侧工作区与会话列表中缺乏直接管理工作树的快捷入口：

1. 想从某个 Git 仓库工作区直接新建工作树会话或查看该仓库的工作树列表，必须先切入会话再通过输入栏分支菜单或插件设置页操作，路径过长。
2. 浏览一个已结束的 linked worktree 会话时，无法在侧边栏会话右键或对话顶部更多菜单直接销毁该工作树，也缺乏一目了然的工作树视觉识别标识。
3. 宿主在 `0.2.2-rc.5` 中已将右键菜单升级为统一的结构化 `ctx.contextMenus` 服务（覆盖 `workspace`、`session`、`sessionHeader` 三类目标及 `contextMenu.icon` 图标槽位），同时开放了会话行原生视觉槽位 `sidebar.session.row.trailing` 与 `sidebar.session.row.hover`，而旧版 `0.2.0-rc.1` 仅提供 `sidebar.workspaces.session.menu.item` 插槽。插件需要在不破坏 `engines.dsh >= 0.2.0-rc.1` 兼容性的前提下，原生融入这套体验且保证打开菜单零卡顿。

## Decision

### 1. 共享工作区 Git 元数据缓存（零卡顿纯内存匹配）

- 新增 `src/client/workspace-git-cache.ts`，复用宿主已有的批量路由 `POST /plugin/git-worktree/group`，在客户端缓存各注册工作区目录的 `WorkspaceGitFacts | null`（含 `repoRoot`、`repoName`、`branch`、`main`）。
- 缓存实现 `ObservableSnapshot`（`getSnapshot` + `subscribe`），在插件启动与 `ctx.workspaces.list` 变更时按新增路径增量批量探测，并在工作区移除后清理陈旧键。
- 右键菜单 `resolve` 与侧边栏装饰组件只做 O(1) 同步内存查表，永不在打开菜单时阻塞等待 Git 子进程；冷缓存未命中时仅触发非阻塞后台补查并通过 `observe` 刷新。

### 2. 结构化原生右键菜单与旧宿主互斥兜底

- 在 `src/client/context-menus.ts` 实现 `registerNativeContextMenus`，在 `src/client/index.ts` 中通过 `ctx.inject(['contextMenus'], ...)` 可选注入，不将 `contextMenus` 列入顶层硬依赖 `inject` 数组，保证旧宿主正常启动。
- 通过 `contextMenu.icon` keyed slot 注册三个原生图标（`git-worktree.create`、`git-worktree.manage`、`git-worktree.remove`）。
- 三类目标的精确行为与排序：
  - **`workspace`（`order: 250`，位于「在应用中打开」之后、「移除工作区」之前）**：非 Git 目录返回空数组；主仓库工作区（`main === true`）显示「从分支新建工作树…」「管理工作树…」（默认按当前仓库筛选）；linked worktree 工作区（`main === false`）仅显示带分割线的危险红操作「删除此工作树…」，不再重复提示新建或管理。
  - **`session`（`order: 520`）与 `sessionHeader`（`order: 520`）**：仅对 linked worktree 会话显示带分割线的危险红操作「删除此工作树…」；主仓库普通会话与非 Git 会话返回空数组，不注入盲推分支或提交图谱等易造成上下文错位的操作。
- 旧宿主降级：默认挂载 `sidebar.workspaces.session.menu.item`（`src/client/LegacySessionMenuItem.tsx`）提供 linked worktree 会话的「删除此工作树…」；一旦原生 `contextMenus` 注入激活，立即卸载旧槽位注册，防止 `0.2.2-rc.5` 上出现重复菜单项。

### 3. 根层全局弹窗宿主与管理弹窗按仓库筛选

- 新增 `src/client/action-bus.ts` 与 `src/client/WorktreeActionHost.tsx`，挂载于 `shell.overlay`（`id: 'git-worktree-actions'`），独立于任何会话输入栏 `BranchChip` 生命周期承载三类弹窗：
  - **管理工作树**：复用 `WorktreeManagerModal`；后端 `WorktreeScanEntry` 新增可选 `repoRoot` 字段，前端新增 `filterScanEntriesByRepo` 与 `initialRepoFilter` prop，从工作区右键打开时默认仅展示当前仓库的工作树，并可一键切换为查看全部仓库。
  - **从分支新建工作树**：支持搜索本地/远程分支、一键复用已有工作树、或直接输入新分支名通过 `cutout` 切出隔离工作树，沿用 `adoptWorktree`、告警 Toast 与后台自动清理链路。
  - **删除此工作树**：复用 `requestInspectWorktree`、`describeWorktreeRemoval` 与 `removeWorktreeFully` 安全删除流，有运行中会话时禁用确认按钮，完成后刷新缓存并通过全局 Toast 反馈。

### 4. 侧边栏工作树视觉标记

- 由于 `dsh-v0.2.2-rc.5` 的工作区标题行（`ProjectRow`）未开放外部装饰插槽，插件利用 `ui-workspace` 原生开放的两个会话行插槽（`src/client/SidebarWorktreeBadge.tsx`）实现工作树识别：
  - `sidebar.session.row.trailing`：为 linked worktree 会话渲染 12px `IconBranchOutlineRegular` 分支图标（hover 时由宿主自动隐藏让给行内操作按钮）。
  - `sidebar.session.row.hover`：在原生 `HoverCard` 中按需展示「工作树 · 仓库名 / 分支名」。
  - 非工作树会话一律返回 `null`。

## Alternatives considered

- **在 `session` / `sessionHeader` 右键同时提供「推送分支」「查看提交图谱」**：侧边栏会话行无法直接呈现分支与领先状态，用户在不明确当前分支的上下文里容易误操作推送；相比之下「删除此工作树」意图清晰且直击清理痛点，因此会话级右键只保留安全删除。
- **把 `contextMenus` 加入插件顶层 `export const inject`**：会导致在 `0.2.0-rc.1` 等不含 `ui-context-menu` 的宿主上整个客户端插件被 Cordis 阻塞不加载，破坏 `engines.dsh >= 0.2.0-rc.1` 兼容承诺。
- **通过 DOM 注入强行改写宿主工作区标题行以挂徽标**：依赖宿主内部 CSS 类名与 DOM 结构，跨版本极易损坏且违背 DSH 插槽契约；改用官方开放的 `sidebar.session.row.trailing` 与 `sidebar.session.row.hover` 槽位稳定可靠。
- **复用或耦合 `BranchChip` 内部弹窗状态**：后台工作区或非当前打开会话的 `BranchChip` 并不挂载，右键触发会失效；独立挂载在 `shell.overlay` 的 `WorktreeActionHost` 彻底解耦视图生命周期。

## Consequences

- **所得**：
  - 用户在侧边栏即可一眼识别工作树会话，并在工作区右键直接按当前仓库管理或新建工作树、在工作树会话/标题栏一键安全删除工作树。
  - 所有右键打开路径均为纯内存同步判定，零 Git 子进程阻塞；原生与旧宿主互斥降级，兼顾 `0.2.0-rc.1` 到 `0.2.2-rc.5+`。
- **代价**：
  - 插件启动及工作区增删时会额外发起一次轻量批量 `POST /plugin/git-worktree/group` 请求用于预热缓存。
  - 若未来上游 DSH 为工作区标题行（`ProjectRow`）新增原生徽标插槽，再补齐工作区级视觉标记即可。
