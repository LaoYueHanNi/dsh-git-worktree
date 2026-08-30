# DR: 分支菜单内置同步远程分支（fetch --all --prune）

Status: implemented

## Problem

分支菜单的远程分支信息来自本地的远程跟踪引用（refs/remotes/*），只在打开菜单、窗口聚焦等时机被动读取——远程仓库新推的分支、已删除的分支，本地不 fetch 就永远看不到。用户必须去终端（或 IDEA）手动 `git fetch --prune`，断了"挑分支"场景的闭环。

## Decision

分支菜单工具条新增第四个图标（刷新，末位——创建/定位/展开折叠是浏览与加工工具，同步是数据源操作，排最下）。点击 → `POST /plugin/git-worktree/fetch`（`{ repoPath }`）→ `git.ts` 新增 `fetchAll` 原语执行 `git fetch --all --prune`（仓库级操作，在 probeRepo 探出的 repoRoot 执行）→ 成功后**菜单保持打开**并自动 `refresh()` 刷新行列表——同步的意义就是当场看到新列表，关菜单违背动线；失败 toast，按钮恢复。执行期间单飞共享 `busyRef`（与确认动作互斥），按钮禁用；网络慢由 executor 的 20 秒硬超时兜底转 GitError。

与 IDEA 的同名动作刻意不同：不搬它的 `-c credential.helper= / -c core.quotepath= / -c log.showSignature=` 三件套和 `--progress`——那些是 IDEA 进程模型（接管认证、渲染进度条、多语言路径）的需要；浏览器插件把认证交给 git 自己的凭据助手，无进度条可渲染。

## Alternatives considered

- **只 fetch origin**（照抄 IDEA）——本插件远程分支列表取"第一个远程"，但仓库可能没有 origin 或有多个远程；`--all --prune` 对单远程仓库成本相同、对多远程更正确。放弃 origin-only。
- **同步后关闭菜单**（沿用 runGuarded 的成功语义）——runGuarded 的关菜单是给"动作完成即离开"的切换/创建用的；fetch 的目的物就是菜单里的列表本身。放弃，fetch 用独立的 doFetch（成功不关菜单），单飞仍共享 busyRef。
- **fs.watch + SSE 推送远程变更**——远程状态在服务端磁盘上根本不会变（fetch 才会变），推送解决的还是"本地 refs 何时更新"，不如把触发权交给用户一次到位。放弃。
- **fetch 后自动推送/对比领先落后**——超范围，push 是写操作且语义完全不同（见菜单里 `↑3` 标记与 fetch 的区别）。放弃。

## Consequences

- 代价：工具条从三个按钮涨到四个（窄列更长）；fetch 是全插件唯一的长耗时网络操作，最多占用 20 秒的 exec 通道，期间其它 git 动作因单飞被挡（可接受——本来也不该并发）。
- 换来："挑分支"闭环不缺页：远程新分支、已删分支、`↑N`/`↓N` 领先落后标记一键刷新，无需离开 Web UI。
- 边界：私有仓库认证失败走 git 自己的报错 → toast；`--prune` 只清理跟踪引用，本地分支永不被动删除。
