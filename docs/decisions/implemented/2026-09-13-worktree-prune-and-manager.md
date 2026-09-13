# DR: 创建前同步上游、惰性清理旧工作树与设置页工作树管理

Status: implemented

## Problem

本插件的工作树只增不减：每个检出过的分支在 storage root 留下一个 `<repoName>-<branch>` 目录，长期使用后（高频 cutout、为每个任务开工作树的工作流）目录数量无界增长，其中大量早已不再使用，但既没有"创建时拿到的代码是不是最新"的保障，也没有一个能看到全部工作树并逐个处置的地方——侧栏分组只展示注册为 workspace 的工作树，孤儿工作树（workspace 已注销、目录还在）完全不可见。同时，删除工作树的完整语义（git 移除 → 归档会话 → 注销 workspace）此前只活在侧栏的确认流程里，无法被其他入口复用。

## Decision

三个设置项（`fetchBeforeCreate` 默认关、`autoPruneWorktrees` 默认关、`keepWorktrees` 默认 30/最小 1/全局配额）驱动三件事：

1. **创建前同步上游**：`POST /worktree` 在 `probeRepo` 之后、`worktree add` 之前执行 `fetchAll`（cutout 与普通流程统一），失败**不阻断**——错误摘要经 `CreateWorktreeResult.fetchWarning` 随成功的 200 响应返回，客户端 toast"已按本地状态创建"。
2. **自动删除旧工作树**：惰性触发——仅在 `doWorktree` 成功（创建 + 注册 + 会话跳转）之后 fire-and-forget 跑一轮，无后台定时器。**执行侧在浏览器**：`POST /worktrees-all` 扫描 storage root 直接子目录（分批 `probeWorkspaceGit`，照抄 `/group` 的批次模式），有效 git 工作树按活跃度升序取超额候选（孤儿目录不占配额也不进候选），逐个 `inspectWorktree`——**dirty 一律跳过，绝不 force**；running 会话目录、新创建目录、当前会话目录排除——干净的走 `removeWorktreeFully`，结果 toast 汇总（清理数 + 失败数）。活跃度 = 该工作树下所有 DSH 会话 `updatedAt` 的最大值，**只看会话**（无会话视为最不活跃）；git commit 时间不参与。plan 与执行器（`worktree-prune.ts`）是纯函数，排序、配额、排除、路径分隔符归一（`pathKey`）全部单测覆盖。
3. **设置页工作树管理**：设置卡片聚合工作区开关的下一行是管理按钮，弹出 `WorktreeManagerModal`——跨仓库列出扫描结果，每行有所属项目、分支、路径、最近使用时间、dirty 警示；删除按钮走共享流程 + 确认弹窗（dirty/ahead/将归档会话数）；running 目录禁删；扫描只列目录（文件被过滤）。
4. **残留文件夹清除**（`POST /purge`）：对扫描出的"无法识别"目录（半失败的 `worktree remove` 留下的无 `.git` 残留，Windows 文件锁中断的典型产物），弹窗提供"删除文件夹"按钮。host 三重设防——路径直接位于 storage root 一层内（与 /ensure-directory 同一 slot 边界）、必须是真实目录、**必须无 git 身份**（git 还认得的目录一律 400 指回 /remove，那里的流程带会话归档）——然后递归强删。若该目录仍挂着 workspace 注册，purge 后照常归档会话并注销。

配套：`worktree-remove-flow.ts` 把删除内核（git 移除 → Windows 半删除 probe 判定 → 归档会话 → 注销 workspace）抽成参数化函数；侧栏确认流程、管理弹窗、自动清理三处共用同一段代码，"与删除工作树功能保持一致"是字面意义的同一段。设置卡片同步扩展：rootDir 与 keep 数字框走 staged 保存（一次 save 写两个草稿、逐字段回读验证），fetch/prune 两个开关写穿（无 seat 交换，无 pending spinner）。

## Alternatives considered

- **自动删除由 host 全权执行**——删除语义的一半（归档会话、注销 workspace）只能由浏览器调 DSH workspace API 完成，host 单侧删会留下幽灵 workspace 与散落会话，恰是侧栏流程刻意避免的后果；给 host 引入 workspace 依赖则要重写一套已存在的语义。放弃。
- **host 只做 git 移除、把被删列表塞进创建响应、客户端补清理**——保护规则被劈成两半：dirty 检查 host 能做，running 会话保护 host 无从谈起（session 状态在浏览器），"先斩后奏"让保护形同虚设。放弃。
- **客户端全流程（胜出）**——触发点（新建工作树）本就只能在浏览器发生，浏览器在线是天然满足的依赖；保护规则、删除语义、设置读取全部复用现成积木，host 侧仅加一条扫描路由。
- **活跃度取目录 mtime**——构建产物会刷新 mtime，刚跑过构建的废弃工作树被误判为活跃，语义失真。放弃。
- **活跃度掺入分支最近 commit 时间兜底**（覆盖"主要在终端干活、DSH 里没开会话"的工作树）——每目录多一次 git 调用，且用户已明确选择纯会话口径；没有 DSH 会话的工作树视为最不活跃、优先删，这是接受的代价。放弃 commit 兜底。
- **活跃度取最老会话的活跃时间**——工作树活跃度从此不随新会话刷新（最老的那个会话永远最老），与"最近活跃程度"的语义相反。放弃。
- **fetch 失败即阻断创建**——更可预测，但网络抖动会挡住纯本地分支的创建，而那类创建根本不消费 fetch 产物。改为不阻断 + warning。
- **管理弹窗只显示当前会话所在仓库**（`GET /status` 现成字段，零新路由）——所有行的所属项目是同一个词，与侧栏 repo 分组几乎重复；管理弹窗的增量价值恰在跨仓库全景 + 覆盖孤儿工作树。放弃，采用 storage root 全局扫描。

## Consequences

- 得：三处删除入口共用同一段流程代码，语义无法漂移；工作树总量有了惰性但有保障的上界；孤儿工作树第一次有了可见性与处置入口；创建时"代码是不是最新"有了开关化保障且失败不伤创建。
- 代价：纯会话口径会把"只在终端使用的长期工作树"排到删除队列最前（管理弹窗可事后发现，误删反馈出现再加 commit 兜底，Alternatives 已留）；管理弹窗打开时对全部有效项并发 `git status`，几十个工作树 = 几十个进程 spawn，量级可控但可感知；自动清理遇 Windows 文件占用按单点跳过，可能出现"删了没删干净"的中间态（toast 点名，弹窗复查）；`keepWorktrees` 是跨仓库全局配额，大仓库会挤占小仓库（用户明确选择的全局口径）；客户端执行依赖浏览器在线——触发点本就只能在浏览器，依赖天然满足。
- 边界：自动清理只保证"每轮创建后数量向 keep 收敛"，不保证立即等于 keep（dirty/running/失败都会留下超额）；`worktrees-all` 扫描只看 storage root 的直接子目录——用户手动 `git worktree add` 到别处的工作树不在管理视野内。
