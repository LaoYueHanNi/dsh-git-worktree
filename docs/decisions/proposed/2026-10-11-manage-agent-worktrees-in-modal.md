# DR: 在工作树管理弹窗中支持管理 Agent 创建的工作树

Status: proposed

## Problem

宿主在 `0.2.1-alpha.2`（以及合并的 PR #5742）中引入了面向 Agent 的原生实验性工作树能力（`@deepseek-ai/dsh-experimental-worktree` 与 `@deepseek-ai/dsh-experimental-tool-worktree`）。当开启该能力后，模型可调用 `create_worktree` 工具在仓库的 `.agents/worktrees/<name>` 目录下创建隔离检出目录，并通过宿主集中的 `working-directory` 服务切换会话执行目录。

宿主的设计理念是“提供机制、不包办策略”——官方架构文档明确说明该服务不维护工作树注册表、不提供清理计划与管理界面，执行完毕或废弃的工作树与分支会永久保留在磁盘上，留由用户或外部消费方自行清理。

目前本插件（`@laoyuehanni/dsh-git-worktree`）的「工作树管理弹窗」仅扫描两处位置：各仓库内的 `.dsh/gitworktree/` 目录以及历史遗留的全局集中根目录（如 `~/.dsh/gitworktree`）。宿主 Agent 创建在 `<repo>/.agents/worktrees/` 下的工作树虽然能被底层 Git 识别并在本插件的分支菜单「工作树」分组中显示，但无法在插件的跨仓库「工作树管理弹窗」中进行集中盘点、状态检查与可视化清理。

用户若要清理 Agent 遗留的大量临时工作树，缺乏直观入口；且容易在终端盲目操作时丢失未提交的修改或未推送的提交。

## Proposal

在工作树管理弹窗中接入对宿主 Agent 工作树的发现与管理能力，提供统一的可视化生命周期中枢：

### 1. 扫描源扩展与来源标识

- 在后端 `handleWorktreesAll`（`src/routes.ts`）中，当遍历已注册工作区对应的仓库根目录时，新增对 `join(repoRoot, '.agents/worktrees')` 目录的扫描。
- 扩展 `WorktreeAllEntry`（`src/wire.ts`）的 `source` 联合类型：从现有的 `'legacy' | 'project'` 扩展为 `'legacy' | 'project' | 'agent'`。
- 当扫描目标位于 `.agents/worktrees` 且由 Git 工作树检出时，标记 `source: 'agent'`。

### 2. 管理弹窗 UI 呈现

- 在管理弹窗（`src/client/WorktreeManagerModal.tsx`）中，为来源是 `agent` 的工作树增加醒目的专属徽标（如 `Agent` 或 `智能体`），并将其归入对应仓库的分组中。
- 完整展示其分支名、路径、最近更新时间，并支持就地触发 dirty 与 ahead 状态检查。

### 3. 复用安全删除流程

- 用户在弹窗中点击删除 Agent 工作树时，复用现有的安全删除流程：
  - 先探测是否存在未提交改动（dirty）与领先提交（ahead）；
  - 存在脏改动时显示醒目告警并要求二次确认；
  - 确认后执行 `git worktree remove`，并在遇到 Windows 句柄残留时触发清理重试；
  - 由于 Agent 工作树并未在 DSH 中注册为独立工作区实体（Workspace），安全流程跳过工作区注销与会话归档步骤（现有 `removalFacts` 已支持 `workspaceId === undefined` 的降级分支）。

### 4. 自动清理（AutoPrune）边界隔离

- 明确界定自动修剪范围：插件已有的 `autoPruneWorktrees`（根据会话活跃度惰性修剪旧工作树）**仅对插件自身创建的目录生效，坚决不自动清理 Agent 工作树**。
- 理由：Agent 工作树可能承载长期任务或未关联前台会话，活跃度指标难以准确代表 Agent 的使用状态；Agent 工作树仅允许用户在管理弹窗中进行**显式、主动的人工清理**。

## Alternatives considered

- **等待宿主官方提供 Web 管理界面** —— 宿主坚持核心最小化原则，官方将 `tool-worktree` 定位为纯面向模型的原子 Tool，明确拒绝在宿主中引入工作树注册表与前端管理面板。由本插件提供是生态中最自然、最高效的分工。
- **将 Agent 工作树纳入插件的 AutoPrune 自动修剪** —— 存在重大误伤风险。自动修剪是后台根据前台会话最近访问时间（`updatedAt`）自动执行的。Agent 创建的工作树没有前台活跃会话，如果被当做过期目录自动删除，会导致 Agent 运行中的任务或跨轮次上下文被破坏。
- **强制将 Agent 工作树重定向到 `.dsh/gitworktree` 存放** —— 不可行。宿主 `WorktreeService` 拥有独立的配置和默认逻辑（`.agents/worktrees`），强行干预其文件系统分配破坏了与官方包的解耦，也会破坏使用官方插件的用户预期。

## Acceptance criteria

1. 后端 `POST /worktrees-all` 能够正确扫描出已打开仓库根目录下 `.agents/worktrees` 中的工作树，并在响应中将 `source` 正确标记为 `agent`。
2. 「工作树管理弹窗」能正常渲染来源为 `agent` 的工作树条目，带有明确的来源标识，并能正常展示 dirty 与 ahead 检测结果。
3. 用户在管理弹窗中可以安全删除 Agent 工作树，成功执行 `git worktree remove` 并刷新列表。
4. 插件的 `autoPruneWorktrees` 自动修剪逻辑不受影响，绝不误触或自动删除任何 Agent 工作树。
5. 运行 `node docs/decisions/check.mjs` 校验通过，无死链与格式错误。

## Risks

- **宿主目录配置自定义**：宿主 `WorktreeService` 允许通过 `directory` 配置项修改工作树存放目录（默认是 `.agents/worktrees`）。若用户自定义了非默认路径，仅基于硬编码路径扫描将无法捕获自定义路径。后续可考虑基于 `git worktree list --porcelain` 识别出不属于本插件但属于仓库下的外部 linked worktrees 进行兜底归类。
