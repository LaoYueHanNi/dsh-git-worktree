# DR: 会话所在工作树的判据——`toplevel` 与 `main` 两个事实

Status: implemented

## Problem

[删除工作树生命周期](2026-09-01-worktree-remove-lifecycle.md)的 Windows 特例把 `probeRepo` 的 `repoRoot` 从「查询目录的 `--show-toplevel`」改成了「`dirname(--git-common-dir)`」，理由现在仍然成立：`worktree remove` 会连被删工作树的 `.git` 一起拆掉，之后的 `worktree list` / `worktree prune` 必须跑在一个活着的 git 目录里，也就是共享检出。

代价是 `repoRoot` 的语义**反了**：它从此在任何一个工作树里都指向主检出。而两处下游继续把它当作「会话所在的目录」读：

1. `BranchChip` 的会话作用域判据 `inLinkedWorktree = worktrees[main].path !== repoRoot`。两边都是主检出路径，比较恒等 → **恒 false**。[工作树会话的菜单作用域三分](2026-08-31-worktree-session-menu-scope.md)的整个收敛（行置灰、锁定、工具收起）因此静默失效：空白的工作树会话看到一个完整的、看起来什么都能干的菜单。
2. `handleUpdate` 的 `updateBranch(exec, facts.repoRoot)`。它的文档与 `updateBranch` 自己的文档都写着「更新查询目录所检出的分支」，实现却是更新主检出——在工作树会话里点「更新当前分支」，动的是另一个目录的分支。
3. 同一类还有 `handleSwitch`（`switchBranch(repoRoot)`）与 `handleCreateBranch`（`createBranch(repoRoot)`）：两者都声明「在查询目录的 toplevel 执行」，实现都落在主检出。它们在工作树会话里本该不可达（前者的入口按作用域收起，后者被 `canCreate = !inLinkedWorktree` 关掉），但判据失效让它们同样可达。

用户可见的形态：会话在 `main-2` 工作树里右键 `main-wt` 点「签出」，菜单关闭、分支不变——因为 `git switch` 切走的是主检出的分支，而 chip 显示的是会话自己目录的分支。这就是报告里的「没有反应」。

## Decision

给 `RepoFacts` 补两个事实，并在下游按「命令作用于哪一层」分派：

- **`toplevel`**：查询目录自己的 `--show-toplevel`，即会话实际所在的那个工作树。作用于「会话自己的检出」的命令用它——现阶段是 `handleUpdate`（fast-forward 会话工作树持有的分支）与 `handleCreateBranch`（no-`from` 的 `switch -c` 从会话的 HEAD 切出并在此检出，`from` + `checkout` 的「并检出」也是此处）。
- **`main`**：该目录是否即主检出，判据是**自己的 toplevel 是否持有共享的 `.git`**（`normalize(resolve(toplevel, '.git')) === gitDir`）。它与 sidebar 的 `probeWorkspaceGit.main` 是同一道判据，抽成 `isMainWorktree` 共用；`/status` 把它透出给前端。
- **前端判据改为 `inLinkedWorktree = !facts.main`**：不再比路径（两边都可能被 normalize/盘符/大小写咬到），而是读 host 已经判定好的布尔。
- **仓库级命令继续用 `repoRoot`**：分支 ref 列表、`worktree list` / `add`、`fetch`、`rename`、`delete`。这些与「哪个目录问的」无关，用共享检出反而是必须的。
- **`/switch` 保持 `repoRoot`**：它的契约就是「主检出的原地切换」（wire 的字段注释与 `switchBranch` 的文档都这么写）。判据修好之后，工作树会话不再提供签出入口，可达集合与语义一致；将来若放开工作树会话的签出，这条要连同 `switchBranch` 的文档一起改。

## Alternatives considered

- **把 `repoRoot` 改回 `--show-toplevel`，前端比较照旧**——即回退 2026-09-01 那条决策：`worktree remove` 之后在没有 `.git` 的目录里跑 `worktree list` / `prune` 会直接报 `not a git repository`，而那正是删除流程唯一的自愈路径。放弃。
- **用 `worktree list` 里 main 项的 `path` 做比较**——那份列表被 `dirExists` 过滤（一个 stale 的主注册就能让答案翻转）、多一次 git 调用，而且它的 `main` 标志回答的是另一个问题：git 认为哪个条目是主，不是被问的目录属于谁。放弃。
- **前端拿 cwd 与 `worktrees[].path` 做前缀匹配**——cwd 可能是工作树里的任意子目录，前缀匹配对嵌套工作树、大小写、symlink 都不稳；而且这是把 host 已经知道的事实推到前端重算。放弃。
- **只加 `toplevel`，前端自己与 `repoRoot` 比**——两个都在同一份 facts 里，看着更省一个字段，但判定又散回前端，且路径比较的坑一个不少。放弃：`main` 布尔把判定收敛到与 sidebar 同源的一处，`toplevel` 只为 host 的命令服务。
- **合并成一个 `sessionWorktree` 字段**——它要同时表达「会话所在的工作树」与「命令该在哪跑」两层，读者还得先弄清"session worktree"是不是又一个 git 概念；`toplevel` 是 git 自己的词，两个字段的文档各写清分界就够。放弃。
- **顺带把 `/switch` 也改用 `toplevel`**——没有可达行为差异（工作树会话不再提供该入口，主检出会话两者同值），却会让它违背自己声明的契约。放弃，留给"放开工作树会话签出"那一刻一起改。

## Consequences

- 得：链路下游对「会话在哪」的判断首次真正生效——工作树会话的行集随之收窄为「本目录分支 + 可跳的工作树」（见[工作树会话展示什么](2026-09-14-worktree-session-menu-rows.md)）；「更新当前分支」更新的是会话自己的工作树；`/status` 的 `main` 与 `/group` 的 `main` 同口径，两处不会给出不同答案；下游只剩两处需要区分「仓库级还是工作树级」，且各自的字段文档写明了。
- 代价：`RepoFacts` 与 `RepoStatus` 各多一个字段；`isMainWorktree` 成为必须维护的一道共用判据；`toplevel` 是**这一次查询**的事实，与 `repoRoot` 这个**仓库**的事实并列在同一个结构里，误用不会报错（两种值都是合法目录），只能靠文档与测试守。
- 边界：判定只覆盖 host 认识的动作，终端里在别的工作树操作插件不感知；`main` 由单次 `rev-parse` 的输出推出，不额外校验目录存在性（查询目录必然存在，否则 git 命令本身先失败）；`handleSwitch` 的「主检出契约」在放开工作树会话签出之前都是对的，那时必须同步改，否则会安静地切走主检出。
