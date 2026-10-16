# DR: 本地分支行尾展示上游领先落后标记（↑N/↓N）

Status: implemented

## Problem

fetch 之后哪些本地分支落后于上游、哪些带着未推送的提交，菜单里无从判断，得逐个去终端 `git log` 对比。[同步远程分支](2026-08-30-fetch-sync-remote.md)的 Consequences 早已把 `↑N`/`↓N` 列为未来方向；[远程分支分组上线](2026-08-30-remote-branches-in-menu.md)后，"本地分支 vs 远程分支"的对照关系更需要一眼可读——领先落后标记正是那个对照的数字形态。

## Decision

> [!NOTE]
> 本决策中的单色直箭头、隐藏 gone 状态与 upstream 契约已于 2026-10-15 由 [DR: 分支显式推送、首次发布确认与 IDEA 同步箭头](2026-10-15-branch-push-and-colored-tracking.md) 取代。以下保留原选择的理由；现行渲染使用绿色 ↗ / 蓝色 ↙，并区分未发布、同步和 gone。

`listBranches` 的本地分支 `for-each-ref` 使用 `%(refname:short)%(upstream:track)%09%(upstream:short)`：track 段直接拼在 refname 后，渲染为 `[ahead N, behind M]`（或裸 `[gone]`）。`[` 在 refname 里非法，`indexOf('[')` 无需分隔符即可安全切分；正则提 `ahead N`/`behind M` 写入 `BranchEntry.ahead`/`behind`（可选数字，仅在非零时出现）。upstream 名称和 gone 状态按新记录透传。git 原生计算，status 采集无额外进程。

客户端在本地行尾（HEAD check 左侧）渲染同步标记，现为绿色右上/蓝色左下 SVG 箭头：11px、`tabular-nums`，`title` 给出完整含义（"领先上游 N 个提交"）。树视图与搜索视图同渲染；远程行没有 upstream 概念，永不渲染。

## Alternatives considered

- **单独一列 track + 显式分隔符**（如 `%09` 制表符）——refname 禁止 `[`，拼接 + `indexOf('[')` 已经零歧义；显式分隔符反而多一个"分支名撞分隔符"的心智负担（git refname 允许制表符以外的大量符号）。放弃。
- **语义色**（↑ 绿 / ↓ 红）——行内已有名字、徽标、HEAD check 三层信息，红绿超出本菜单的单色语言，色弱场景可读性也差。放弃，次级色调 + tooltip 承担语义。
- **渲染 `[gone]` 标记**——`fetch --prune` 后 gone 罕见，且其修复动作（删本地分支或重设 upstream）都不在本菜单里，标记没有操作出口，只制造焦虑。放弃。
- **只对当前分支显示**——ahead/behind 对所有有 upstream 的分支都有意义（IDEA 即全量显示），只显示当前分支会让"该切哪个分支去更新"失去判断依据。放弃。

## Consequences

- 得：fetch/更新之后每个本地分支与远程的关系一眼可读，"挑分支"场景里领先落后与远程组互为对照；数据来自 git 原生 track 计算，status 无额外进程、无额外往返。
- 代价：`BranchRow` 承载可选字段的透传链（wire → BranchChip → BranchMenu）；现行箭头的颜色和未发布语义见新记录。
- 边界：ahead/behind 反映本地 remote-tracking ref 的状态，fetch 才会更新——与菜单数据本身的拉取时机（打开/聚焦/操作后）口径一致，不存在更陈旧的通道。
