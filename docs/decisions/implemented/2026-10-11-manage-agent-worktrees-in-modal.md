# DR: 在工作树管理弹窗中支持管理 Agent 创建的工作树

Status: implemented

## Problem

宿主在 `0.2.1-alpha.2`（以及合并的 PR #5742）中引入了面向 Agent 的原生实验性工作树能力（`@deepseek-ai/dsh-experimental-worktree` 与 `@deepseek-ai/dsh-experimental-tool-worktree`）。当开启该能力后，模型可调用 `create_worktree` 工具在仓库的 `.agents/worktrees/<name>` 目录下创建隔离检出目录，并通过宿主集中的 `working-directory` 服务切换会话执行目录。

宿主的设计理念是“提供机制、不包办策略”——官方架构文档明确说明该服务不维护工作树注册表、不提供清理计划与管理界面，执行完毕或废弃的工作树与分支会永久保留在磁盘上，留由用户或外部消费方自行清理。

此前本插件（`@laoyuehanni/dsh-git-worktree`）的「工作树管理弹窗」仅扫描两处位置：各仓库内的 `.dsh/gitworktree/` 目录以及历史遗留的全局集中根目录（如 `~/.dsh/gitworktree`）。宿主 Agent 创建在 `<repo>/.agents/worktrees/` 下的工作树虽然能被底层 Git 识别并在本插件的分支菜单「工作树」分组中显示，但无法在插件的跨仓库「工作树管理弹窗」中进行集中盘点、状态检查与可视化清理。

用户若要清理 Agent 遗留的大量临时工作树，缺乏直观入口；且容易在终端盲目操作时丢失未提交的修改或未推送的提交。

## Decision

在工作树管理弹窗中接入对宿主 Agent 工作树的发现与管理能力，提供统一的可视化生命周期中枢：

1. **扫描源扩展与来源标识**：
   - 在后端 `handleWorktreesAll`（`src/routes.ts`）中，当遍历已注册工作区对应的仓库根目录时，扫描 `join(repoRoot, '.agents', 'worktrees')` 目录。
   - 扩展 `WorktreeScanEntry`（`src/wire.ts`）的 `source` 联合类型为 `'legacy' | 'project' | 'agent'`。
   - 当扫描目标位于 `.agents/worktrees` 下时，标记 `source: 'agent'`。

2. **孤儿目录清理安全守卫**：
   - 后端 `handlePurgeDirectory` 引入 `insideAgentLayout` 校验，允许用户在弹窗中清理非 Git 的残留孤儿目录。
   - 严格校验对应仓库根目录和 `.git` 存在，防止越界删除。

3. **弹窗分组与 UI 呈现**：
   - 在客户端 `src/client/scan-groups.ts` 中，`groupScanEntries` 将分组排序优先级定义为 `project` (0) < `agent` (1) < `legacy` (2)，并在同一来源内按仓库名数字自然排序（如 `repo2` 排在 `repo10` 前面）。
   - 在管理弹窗（`src/client/WorktreeManagerModal.tsx`）和多语言配置（`src/client/locales.ts`）中，为来源是 `agent` 的工作树呈现来源徽标（中英文字段均为 `Agent`），并归入对应仓库分组。
   - 完整展示其分支名、路径，支持就地触发 dirty 与 ahead 状态检查，并复用安全删除流程。

4. **AutoPrune 自动修剪安全隔离**：
   - 在 `src/client/index.ts` 中，自动清理逻辑在传递候选路径前显式过滤掉 `entry.source === 'agent'` 的条目。
   - 自动修剪仅对插件自身创建的目录生效，绝不自动清理 Agent 工作树；Agent 工作树仅允许用户在管理弹窗中进行显式、主动的人工清理。

## Alternatives considered

- **等待宿主官方提供 Web 管理界面** —— 宿主坚持核心最小化原则，官方将 `tool-worktree` 定位为纯面向模型的原子 Tool，明确拒绝在宿主中引入工作树注册表与前端管理面板。由本插件提供是生态中最自然、最高效的分工。
- **将 Agent 工作树纳入插件的 AutoPrune 自动修剪** —— 存在重大误伤风险。自动修剪是后台根据前台会话最近访问时间（`updatedAt`）自动执行的。Agent 创建的工作树没有前台活跃会话，如果被当做过期目录自动删除，会导致 Agent 运行中的任务或跨轮次上下文被破坏。
- **强制将 Agent 工作树重定向到 `.dsh/gitworktree` 存放** —— 不可行。宿主 `WorktreeService` 拥有独立的配置和默认逻辑（`.agents/worktrees`），强行干预其文件系统分配破坏了与官方包的解耦，也会破坏使用官方插件的用户预期。

## Consequences

- **收益**：
  1. 用户在管理弹窗中拥有统一的跨仓库工作树可视化看板，可集中盘点、检查状态（dirty/ahead）并安全删除 Agent 遗留工作树。
  2. 保护 Agent 任务现场：自动清理与 Agent 工作树严格隔离，避免后台自动误删正在运行的智能体上下文。
  3. 宿主兼容性平滑：维持 `peerDependencies` 声明不变（`^0.2.0-rc.1`），在无 `.agents/worktrees` 目录的老版本中静默返回空，在 0.2.1-alpha.2 新版本中自动生效，无需破坏老版本兼容。
- **代价与权衡**：
  1. 扫描开销轻微增加：每个仓库根目录增加一次 `.agents/worktrees` 目录的并发探测，由于仅读取直接子目录且有数量上限截断，性能影响可忽略。
  2. 目录硬编码约束：当前实现扫描宿主默认的 `.agents/worktrees` 路径。若用户在宿主中自定义了非默认的 `directory` 配置项，该定制路径暂时无法被本插件自动发现。
