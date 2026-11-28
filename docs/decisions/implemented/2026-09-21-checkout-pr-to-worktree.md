# DR: 支持将 PR/MR 一键检出到独立隔离工作树

Status: implemented

## Problem

在日常研发与代码审查（Code Review）流程中，开发者经常需要在本地运行、测试或修改其他协作者提交的 Pull Request (PR) 或 Merge Request (MR)。

此前在插件中检出远程分支时，只能依赖全局 `fetch` 后从「远程分支」列表中手动寻找对应的远程分支名（如 `origin/feature-xxx`），步骤繁琐，且外部协作者从 fork 仓库提交的 PR 并未直接挂载在主仓库的日常分支列表中。即便宿主启用了官方实验套件 `@deepseek-ai/dsh-experimental-forge-bundle`，其工作树创建也只支持从已有本地/远程跟踪分支或当前 `HEAD` 新建，缺乏将指定 PR/MR（尤其是外部 Fork PR）一键检出到本地独立隔离工作树并衔接回原生 PR 审查面板的闭环。

## Decision

在保留纯原生 Git 零依赖兜底的前提下，以**可选注入**方式深度结合 `@deepseek-ai/dsh-experimental-forge-bundle`，实现「一键检出 PR / MR 到独立隔离工作树」：

1. **元数据查询与原生 Git 隔离检出解耦**：
   - 本地检出统一在 `src/git.ts` 与 `src/routes.ts`（`POST /plugin/git-worktree/pr-checkout`）通过原生 `git fetch --progress <remote> refs/pull/<id>/head`（GitHub）或 `refs/merge-requests/<id>/head`（GitLab）拉取到独立临时引用 `refs/dsh-pr-tmp/<uuid>`（不触碰 `FETCH_HEAD` 并在 `finally` 自动清理）并解析精确 commit SHA，再通过 `addWorktreeAtCommit` 检出到 `<repoRoot>/.dsh/gitworktree/github-pr-<id>`（或 `gitlab-mr-<id>`），绝不改动主仓库 `HEAD`（若主仓库本身正占用同名分支则明确拦截提示）。
   - 检出及每次更新后在 `<worktreeGitDir>/dsh-worktree-base` 写入 PR 来源标签（如 `PR #42` / `PR #42 → main`）供侧边栏悬停展示，并在 `<worktreeGitDir>/dsh-worktree-pr-sha` 记录上次同步的 PR SHA。
   - 当对应工作树已存在时支持「直接打开（`reuse`）」与「同步更新（`update`，仅干净工作树）」：能快进时走 `--ff-only`；若 PR 作者 rebase / force-push 且当前 `HEAD === 上次 PR SHA`（确认无本地提交），自动执行 `git reset --hard <newSha>` 安全同步并提示；若本地存在独有提交（或无历史 SHA 记录），返回 `409 worktree_diverged` 由弹窗提供「保留本地直接打开」或二次确认「重置到 PR 最新（`reset`）」。当本地已有同名分支但无工作树且含未合并提交时保留原分支不丢弃提交。
2. **Host 侧可选增强 `ctx.forge` 与多 Remote 联动**：
   - 在 `src/index.ts` 通过可选 `ctx.inject(['forge'], ...)` 探测宿主 Forge 服务（最小鸭子类型守卫 `isForgeServiceLike`），在 `POST /pr-context`（支持按指定 `remote` 切换查询，将 `readiness` 与 `listForViewer` 拆分为独立超时预算并在宿主不支持或全部查询失败时显式上报 `listUnsupported` / `unavailable` 而非伪装为空列表）与 `POST /pr-resolve` 中复用其主机识别（支持 GitHub Enterprise 与自建 GitLab）、仓库归属校验与当前仓库「全部 / 待我评审 / 我创建的 / 与我有关」候选列表。
   - `POST /pr-resolve` 在本地规则校验通过后，针对非主仓库占用且尚未存在本地工作树的输入，默认通过原生轻量 `git ls-remote -- <remote> <refSpec>`（带 12 秒硬超时与 HTTP 断连 `AbortSignal` 级联中止）实时核验远端 PR/MR 引用是否存在，避免用户输入不存在的编号后仍亮起检出按钮或挂载无效的延迟工作树任务；当点选当前实时候选列表项时传 `verifyRemote: false` 跳过冗余往返；远端确认存在且宿主 `ctx.forge.fetchChecks` 可用时，并行补拉标题、作者与合并/关闭状态（3.5 秒软超时静默降级）。
   - 宿主未启用 `forge-bundle` 或未登录时自动降级至 `src/pr.ts` 内置 URL/Remote 解析与纯 Git 拉取；所有 PR 解析与 Git 失败均输出结构化 `PrErrorCode` 供前端中英文精准提示。
3. **多入口触发、双工作区模式衔接与自动回绑**：
   - 在 `BranchMenu.tsx` 左侧工具栏与 `context-menus.ts` 主仓库右键菜单提供「检出 PR / MR…」入口；弹窗内将候选列表选中态与搜索/输入框解耦，点击列表项不破坏其余候选可见性，预览区优先复用候选元数据。
   - 在 `src/client/ForgeIntegration.tsx` 可选挂载 `forge.change-request.card.actions` 与 `forge.changes.toolbar` 槽位：当会话已位于目标 PR 工作树中时自动切换为「同步 / 更新此 PR 工作树」并默认预选 `update`。
   - 兼容「独立工作区」与「会话目录切换（`switchSessionDirectory`）」双模式：在 `switchSessionDirectory` 模式下，当用户尚未身处目标 PR 工作树内时，新建检出、复用已有工作树及更新后的切换均通过 `DeferredWorktreeCoordinator`（`armDeferredWorktree`）挂载至首条消息发送时再拉取创建或切换工作目录，避免提前改写空白会话的 `workingDirectory` 投影而导致 `Ctrl+N` 无法返回主仓库新建会话；已有独立工作区模式或身处目标 PR 工作树内更新时则立即就地生效；完成后若客户端存在 `remote.forgePanel.track`，自动回绑规范 PR/MR URL，补齐官方 `findByHead` 不发现 Fork PR 的短板。
4. **双插件共存避让**：
   - 侧边栏徽标与悬停复用 `SidebarWorktreeBadge.tsx` 的 `shouldDecorateSession`（内部基于 `hasForgeManagedWorktree` 避让官方 `forgeWorktree` 托管会话），并为 PR 来源标签展示 `工作树 · PR #42 → main` 样式。

## Alternatives considered

- **强制依赖 `@deepseek-ai/dsh-experimental-forge-bundle` 或外部 `gh` / `glab` CLI 工具** —— `forge-bundle` 在宿主中属于默认禁用的实验套件，且部分开发者环境未安装或未登录官方 CLI，强依赖会导致功能在大量环境下不可用；采用可选增强 + 原生 Git 兜底可兼顾体验与通用性。
- **直接调用 `gh pr checkout <id>` 完成本地检出** —— `gh pr checkout` 会在当前主仓库直接切换 `HEAD`、受主工作区脏文件阻塞并污染工作区状态；将查询与原生 `git fetch` + `worktree add` 解耦才能实现真正的零污染隔离检出。
- **完全忽略宿主 `forge` 服务、自行维护全套托管平台鉴权与 PR 列表** —— 会重复造轮子，既无法继承自托管主机配置，也无法在检出后自动回绑原生 PR 卡片。
- **本地分支采用无前缀命名（如纯 `pr-<id>`）** —— 同一仓库关联多个上游托管源（例如 GitHub 与内部 GitLab）时容易发生命名碰撞。

## Consequences

- **所得**：
  - 无论宿主是否启用 `forge-bundle` 或是否安装 `gh`/`glab`，均可在不污染主仓库的前提下把同仓及外部 Fork PR/MR 一键检出为隔离工作树；
  - 启用 `forge-bundle` 时获得候选列表直选、卡片/Diff 工具栏一键落盘、检出后自动回绑 PR 卡片以及侧边栏徽标去重的完整闭环；
  - 对 `@deepseek-ai/dsh-experimental-*` 仅使用运行时可选探测与鸭子类型守卫，保持 `engines.dsh >= 0.2.0-rc.1` 兼容。
- **代价**：
  - 宿主 `client-ui-forge` 的独立「代码评审」专页详情（`ReviewDetail`）头部暂未开放外部扩展槽位，专页入口暂未挂载；
  - 私有仓库纯 Git 降级拉取依赖本地 Git 凭据助手；Fork PR 检出后的推送仍受远端权限约束。
