# DR: 侧边栏按仓库聚合工作区（替换原生 sidebar.workspaces）

Status: implemented

## Problem

每个被注册为 DSH 工作区的 worktree（`adoptWorktree` 流程）都在左侧平铺为一个顶层条目：主仓库 `dsh-git-worktree` 与它的工作树 `dsh-git-worktree-feat-x` 之间没有任何视觉关联，工作树一多列表就被同仓库的分身条目淹没；同时「某个会话属于哪个仓库的哪个分支」从列表本身读不出来。DSH 原生没有层级/分组工作区概念，也不开放多工作区聚合接口。

## Decision

本插件占用 `sidebar.workspaces` seat（原生浏览器是默认占用者，本条目以 `priority: -1` 在其默认 cell 之上获胜），把左侧浏览区做成与原生 `dsh-client-ui-workspace` 功能与外观 1:1 的替换品，并在其上按 git 仓库聚合工作树。设置卡开关「聚合工作区」可随时切回原生。

- **分组完全派生**：逐 workspace path 经 `/plugin/git-worktree/group` 探测 `rev-parse --show-toplevel` + `--git-common-dir` + `branch --show-current`；`--git-common-dir` 的 `dirname` 即分组键 `repoRoot`。不存任何关系数据。
- **单成员组降级为普通行**：组内只有 1 个 git workspace（或探测失败/非 git）时渲染为 plain 行（原生 title）。多成员组头显示仓库 basename，右侧徽标为该组**可见会话总数**；主 checkout 标 `主仓库（branch）`（detached/unborn 省略括号），linked 行显示分支名（无分支兜底 workspace title）。
- **排序锚定**：组渲染在组内首个成员的注册位置；组内主 worktree 在前、linked 按注册顺序。
- **行为与外观 1:1**：会话可见性、打开/新建、搜索、行内菜单、StateDot、相对时间、HoverCard、ViewOptions、rail 双按钮、三个对话框均移植自原生打包产物（`@deepseek-ai/dsh-client-ui-workspace` 的 Rows + WorkspaceBrowser + 字典），控件走已有 primitives，不自绘。纯逻辑在 `sidebar-search.ts` / `sidebar-groups.ts`（含本地 `indexSubagentRunning`，避免测试加载 runtime 浏览器包）。视图偏好 `groupBy`+`orderBy` 用本插件 localStorage，默认 workspace+updated。
- **逃生开关**：settings namespace `git-worktree` 的 `groupSidebar: boolean`（默认开）。勾选框读 `CardForm` 快照，立即写穿、不走 `rootDir` 的暂存/保存；禁止做成 inject 时拍死的 props。写穿不等于侧栏已换完：开启等 GroupedSidebar 第一次 `/group` 结束（`onReady`），关闭等 occupant dispose + 一帧绘制；20s 超时兜底。
- **目录选择**：原生已声明 `sidebar.workspaces.directoryFlow`，本插件不再声明该 hole（SlotCore 第二次声明会抛错；抢先声明会让关开关后无逃生）。Add 仍按 occupancy 显示，实际走 `workspaces.pickDirectory` + `createWorkspace`；选择流程是边缘触发的（`PickFlowController`）：仅 open 上升沿启动一次选择器，父组件重渲染只刷新回调、不会重新拉起，关闭或卸载作废在途回调——防的是「sessions 推送触发重渲染导致选择器反复弹出、用户的选择被 live 标志吞掉」。
- **探测**：`/group` 对去重 path 每批 8 个并行、上限 256；单个 path 失败只把该项置 `null`，整体恒 200。facts 未就绪/请求失败时分组降级为平铺，搜索/菜单仍可用。

## Alternatives considered

- **浏览器端虚拟投影（clutch-dsh 模式）**——把 worktree 会话以内存投影注入原生 workspace 列表，不动原生浏览器。该方案是为「worktree 不注册为原生 workspace」的路线服务的；本插件的工作区本来就是原生注册表成员，投影反而引入第二份易失状态。放弃。
- **overlay 附加视图（footer action + shell.overlay）**——不动原生列表，另开一个聚合视图。聚合不是左侧的默认长相，需要每次切换。放弃。
- **title 前缀伪聚合**——给 worktree 工作区统一命名前缀。零代码但无折叠无层级。放弃。
- **host 侧为每个 worktree 建子 workspace 注册表**——分组键已在磁盘（git common-dir），持久化副本只会漂移。放弃。
- **复用原生 `dsh.workspace.view.v5` store**——那是 ui-workspace 条目的 exclusive store seat，本插件 occupant 无法挂上别人的 handle。放弃。
- **再声明 `sidebar.workspaces.directoryFlow` 并 `renderSlot` 原生 picker**——SlotCore「一 hole 一声明者」；二次声明必抛，抢先声明则关掉开关后无逃生。放弃，改走 `pickDirectory`。
- **自绘状态点/菜单/搜索框**——无法 1:1，且 primitives API 已与原生调用形状一致。放弃。
- **变更 DSH 源码加层级 workspace / 开放 store v5**——超出插件边界，零 upstream 改动。官方接口一旦开放，改用原生实现。

## Consequences

- 得：同仓库工作区在左侧聚成一棵树，会话归属可读；搜索/菜单/状态/样式与原生同形同文；零冗余分组状态；关掉开关或卸载即恢复原生列表。
- 代价：添加工作区走 OS 目录选择器，不是原生 in-app directoryFlow UI；不持久化手动拖拽顺序；视图偏好与原生 store v5 不共享；组头徽标只出现在多成员仓库组。预抢占的 single cell 若与未来其他插件冲突，由优先级裁决，开关仍可逃生。
- 边界：分支标签随 facts 路径集合刷新，切分支不即时反映；`/group` 每 path 3 条 git 命令、批内并行，17+ 工作区量级实测无感；内容搜索 RPC 失败 → `search.unavailable` + 仅本地匹配；fork/archive 失败静默、rename/delete 失败弹错（与原生一致）。
