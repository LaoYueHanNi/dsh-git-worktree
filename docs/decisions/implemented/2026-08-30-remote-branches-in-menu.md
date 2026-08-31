# DR: 分支菜单分组展示远程分支并支持检出

Status: implemented

## Problem

分支菜单只显示本地分支——尽管远程分支数据早已由 host 采集并随 `/status` 下发（客户端 `buildBranchRows` 把 `kind: 'remote'` 一行过滤掉了）。远程新分支（同事刚推的、fetch 同步下来的）在菜单里不可见，用户必须去终端 `git switch origin/xxx` 或先手动建跟踪分支；[同步远程分支](2026-08-30-fetch-sync-remote.md)解决了"看到"，没解决"用上"，挑分支的闭环仍缺最后一页。另外 host 只取第一个远程的分支，fork 工作流（origin + upstream）下的分支永远不可见。

## Decision

菜单列表渲染为两个顶层可折叠分组头（复用文件夹头的 chevron + 计数姿态）：**本地分支**在上、**远程分支**在下，组内沿用 `/` 前缀树。组开合是独立布尔态，不进 `expanded` 路径空间；两组树的文件夹折叠键带 `local:`/`remote:` 组前缀，本地与远程显示路径同名时互不串台。

远程行的显示名：**单远程时剥离 `<remote>/` 前缀**（`origin/feat/x` 显示为 `feat/x`——组头已经说了"远程"，`origin` 作为顶层文件夹纯占缩进）；**多远程时保留全名**，`origin`/`upstream` 自然成为组内文件夹层，同名分支靠它消歧。剥离不产生与本地行的显示冲突：host 一直隐藏有本地孪生的远程分支，剥离后的名字与本地行名不可能重合（这条既有决策是剥名安全的前提）。选中/锚定走显示名，`pick` 经显示名→真名映射把 `origin/feat-x` 交还 owner。

远程行确认走远程语义文案，且刻意**两行结构化**：主行是短问（`switchAskRemote`「是否检出该远程分支？」/`worktreeAskRemote`「从该远程分支新建工作树？」），分支全名独占一行 500 字重——单句塞长分支名会把中文句子拆得七零八落，名字独立成行后断行只发生在名字内部；dwim 建跟踪分支/孪生建 worktree 是 git 的默认行为，不再赘述第三行说明。动作仍打现有 `/switch` 与 `/worktree` 路由——`resolveBranch` 早已支持远程显示名（dwim 建跟踪分支 / `worktree add -b <local> <remoteRef>`），**检出路径后端零改动**。禁用规则统一为 `occupied.has(localBranchName(name))`：远程行的本地孪生被 worktree 占用时禁用（非 worktree 模式），与本地的占用规则同一行代码。新建分支/切出命名的重名检查只对比本地行。默认展开沿用 TREE_MIN_ROWS：超过 8 行本地组 + 当前链开、远程组收起，不超过则全开。

多远程放开：删除 `listBranches` 的"只取第一个远程"折叠，全部远程的 remote-only 分支照常下发（`<remote>/HEAD` 与有本地孪生者的隐藏不变）。`refs/remotes` 下的**裸残留 ref**（短名不含 `/`，如真机发现的 `refs/remotes/origin`——`git branch -r` 同样不显示它）按非分支跳过；`resolveBranch` 对无 `/` 的名字直接拒绝，防止把这类名字误算出垃圾 remote 段，路由层把 not-found 包络判为 400。

## Alternatives considered

- **远程行混入现有树**（`origin` 成为顶层文件夹）——改动最小，但 `origin` 文件夹与本地 `feature` 等文件夹头外观相同，扫一眼分不清哪些是远程；"隐藏 origin 前缀"的诉求更是无处安放。分组让性质差异（远程需建孪生才能检出）可见。放弃。
- **新增 /checkout-remote 专用路由**——`resolveBranch` 已让 `/switch`、`/worktree` 吃远程显示名，新端点是同一语义的第二份契约，还要重做一遍错误分类。放弃。
- **一并支持删除远程分支**（`push <remote> --delete`）——本地分支删除尚且没有，先补齐"检出"主轴；删除是不可逆高危写操作，值得更重的确认形态单独做。放弃（本次）。
- **多远程维持第一个**——`fetch --all` 本就同步所有远程，只显示第一个让同步成果部分不可见；折叠的初衷（菜单降噪）由"远程组默认收起"承担。放弃折叠。

## Consequences

- 得：挑分支闭环补全——远程新分支可见、可检出（原地或 worktree），全程不出 Web UI；本地/远程分组让菜单在多分支仓库里更有秩序；多远程仓库的分支首次可见。
- 代价：`BranchMenu` 多出 `groupRows` 分组层（组拆分、剥名、真名映射）与组前缀键；`renderTree`/`renderSearch`/折叠/全展按钮都要感知组前缀，改动面覆盖整个渲染层；组头缩进使组内行比旧版深一级（12px）。
- 边界：菜单打开期间外部新建了与远程同名的本地分支时，点该远程行会得到 "branch not found" 的 toast（`resolveBranch` 拒绝）——重新打开菜单该行即被隐藏，时序窗口内的报错可接受；远程组的计数是 remote-only 行数（有孪生的不算），与本地组合计不等于仓库分支总数，属刻意口径。
