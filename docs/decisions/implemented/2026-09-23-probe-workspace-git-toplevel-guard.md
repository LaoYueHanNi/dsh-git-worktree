# DR: 工作区探测增加 toplevel 防祖先穿透校验（解决残留子目录被误判为 worktree 的问题）

Status: implemented

## Problem

在工作区与工作树扫描流程中，后台通过 `probeWorkspaceGit` 对目录执行 `git rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD` 探测 Git 事实。

当扫描路径 `path` 是一个普通子目录、或是创建/删除中断后残留的空目录时（例如 `<repo>/.dsh/gitworktree/main-2`，该目录下无独立 `.git` 文件且未被 git 注册）：
1. **Git 向上递归穿透**：`git rev-parse` 会沿文件树向上查找到父级仓库的 `.git`，返回父仓库的 `toplevel`（父仓库根目录）以及父仓库当前检出的分支（如 `main`）。
2. **状态与改动错位套用**：探测结果被误以为是该子目录属于一个合法的分支工作树，甚至在查询工作区状态时执行 `git status`，将父仓库未提交的文件改动统计到了该残留目录下。
3. **删除操作两头死锁**：
   - 作为工作树执行删除时，底层 `git worktree remove` 因在注册表中查无此条目而抛错拒绝（`is not a registered worktree of this repository`）；
   - 作为未识别目录（orphan）执行清理时，`/purge-directory` 路由因 `probeWorkspaceGit` 误判其为合法 git repository 而同样拒绝清理。

## Decision

在 `src/git.ts` 的 `probeWorkspaceGit` 中增加独立性校验：

1. **引入路径同源判定辅助函数 `isSamePath`**：
   规范化处理路径分隔符、末尾斜杠，并在 Windows 平台上进行大小写不敏感的比对。
2. **增加 toplevel 归属校验**：
   比对 `git rev-parse --show-toplevel` 返回的 `toplevel` 是否与被探测的 `path` 指向同一目录。若 `!isSamePath(toplevel, path)`，说明该目录仅是某个祖先仓库内部的普通子文件夹，而非独立工作树或仓库根目录，直接返回 `undefined`。
3. **修复死锁链路**：
   未包含独立 `.git` 的残留文件夹在 `/worktrees-all` 中被正确归为未识别目录（`repoName: null`），不显示虚假的父分支与父未提交文件，并可在管理弹窗中直接通过 `/purge-directory` 物理安全清理。

## Alternatives considered

- **仅在 `insideProjectLayout` 路由层单独检查**：该穿透现象不仅发生在 project layout 子目录下，在任何工作区路径探测中都可能发生。在最底层的 `probeWorkspaceGit` 进行校验能够从根源杜绝所有调用方的误判风险。
- **通过检查磁盘上是否存在 `.git` 文件来过滤**：worktree 的 `.git` 是一个包含 `gitdir:` 的普通文本文件，而 bare 仓库或 submodule 的结构各异。比对 `rev-parse` 返回的 `toplevel` 与输入路径是 Git 官方最权威的“该目录是否为工作树根”的判据。

## Consequences

- **收益**：彻底解决非工作树子目录被 Git 穿透冒充父仓库工作树的 Bug，消除了虚假未提交文件的误报，打通了残留目录的正常清理链路。
- **代价**：增加了微小的路径比较开销，单次探测耗时在毫秒内，完全可忽略。
