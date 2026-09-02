# DR: 侧边栏分组座位的启动快路径与 facts 缓存

Status: implemented

> 本文是 [侧边栏按仓库聚合工作区](./2026-08-31-sidebar-workspace-grouping.md) 的启动时延后续优化，不改动分组语义本身。

## Problem

刷新页面后，替换原生工作区列表的 GroupedSidebar 要经过三段**串行**等待才呈现分组树：

1. settings 文档从 Host 跨进程同步（`settingsScope` 快照 `ready` 之前座位根本不注册，侧边栏一直是原生浏览器）；
2. workspace 基线到达（`workspaces.list` phase `pending` 时列表为空）；
3. `/group` 探测：每个工作区 3 次串行 git 进程 spawn（`rev-parse --show-toplevel`、`rev-parse --git-common-dir`、`branch --show-current`），宿主机按批 8 并发、批间串行。

facts 未返回时 `deriveSidebarGroups` 把所有工作区降级为平铺单行，返回后整棵树重组——用户看到的是"原生列表 → 平铺列表 → 分组列表"的连续跳变，全程数秒。第 3 段随工作区数量线性增长，是"工作区越多越慢"的主因。

## Decision

下列改动落地，目标都是让刷新后路径签名一旦可知，**那一帧**就是分组树：

- **启动即注册座位**（`src/client/index.ts`）：`syncGroupingSeat` 在 settings 快照未 `ready` 时不再直接返回，而是读取 localStorage 中上次已知的 `groupSidebar` 值（`loadGroupSidebarBoot`，缺省按组合层默认 `true`）立即注入座位；`ready` 快照仍是权威，落定后经既有 change 路径校正并写回缓存（`saveGroupSidebarBoot`）。GroupedSidebar 由此与原生浏览器同刻挂载，workspace 基线和 `/group` 探测与 settings 同步并行，不再排在它后面。
- **facts 按签名读取缓存**（`src/client/GroupedSidebar.tsx` + `sidebar-groups.ts`）：最近一次成功的 `/group` 结果（路径签名 → facts）持久化到 localStorage。读取跟签名走，不跟挂载瞬间走：workspace 基线到达、路径集合从 pending 空列表变成真实签名的那一帧就会查缓存（`factsForSignature`）；命中则该帧直接分组渲染，随后后台刷新覆盖。只在 `useState` 初始化器里读一次会在首帧 `signature === ""` 时 miss，之后再也不读——刷新路径正好踩中。探测失败时保留已渲染内容（含缓存），保持既有降级契约。缓存条目按 `WorkspaceGitFacts` 形状校验，任一 path 的 value 不合格则整批丢弃。
- **合并 git 探测命令**（`src/git.ts`）：`probeWorkspaceGit` 由 3 次 spawn 合并为 1 次 `git rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD`（rev-parse 逐 flag 输出一行）。`--abbrev-ref HEAD` 对 detached/unborn 输出合成 `HEAD`，映射为 null——与原 `branch --show-current` 空输出同语义。
- **提升探测并发**（`src/routes.ts`）：`GROUP_BATCH_SIZE` 8 → 16（每目录只剩 1 个 spawn，同并发数下的进程总量反而更低）。
- **跳过空列表探测**（`src/client/GroupedSidebar.tsx`）：workspace 基线未达（phase `pending`、空列表）时不发 `/group`，避免一次空往返和虚假的 `onReady`；基线 `ready` 且真空时立即报告就绪。

## Alternatives considered

- **缓存 repoRoot → facts 而不是按签名缓存整批**：键粒度更细、跨签名复用，但失效判断（目录内容/分支变化无法感知）和膨胀控制复杂；签名整批缓存过期即整体弃用，语义简单。同一路径被换成另一个仓库时，首帧会按旧 `repoRoot` 归组（标签和结构都可能错一帧），后台刷新纠正。放弃细粒度键。
- **宿主侧内存缓存 /group 结果**：能压掉所有重复探测，但需要引入 TTL、失效和进程内一致性管理，且跨重启仍回落到当前路径；留作后续，不在本次范围内。
- **让 `settingsScope` 自己更快**：框架侧行为，插件无法干预；且座位等待的不是设置值本身，而是"文档到没到"——绕过等待（boot 缓存）是插件唯一能做的。
- **`git branch --show-current` 保留、只合并两次 rev-parse**：仍剩 2 次 spawn；`--abbrev-ref HEAD` 与它的唯一差异是 detached/unborn 输出 `HEAD` 而非空串，映射为 null 后完全等价，一次本地验证即确认可行。放弃保留。

## Consequences

- 刷新后，路径签名一旦与缓存一致（含基线从 pending 落到真实列表的那一帧），侧边栏立即以分组形态渲染；`/group` 探测成本约降为原来的 1/3（spawn 次数）且并发翻倍，工作区数量增长时斜率大幅变缓。
- 引入两处 localStorage 键：`dsh-git-worktree.sidebar.groupSidebar`（开关启动值）和 `dsh-git-worktree.sidebar.facts.v1`（facts 批次）。两者都可丢失/损坏，代价仅为一次启动闪动，读函数全部容忍异常。
- 代价：设置值在其他进程/设备变更而本浏览器 boot 缓存与权威不一致时，刷新会闪一次"分组 → 原生"或反之（仅那一次，不是每次刷新）。facts 缓存过时时首帧可能显示旧的 repoName/branch；若路径集合未变但目录已被另一个仓库替换，分组结构也可能错一帧；后台刷新后自动修正。
- `/group` 探测失败后，同一路径签名在本轮挂载内不再重试（避免会话列表每变一次就再打一轮 git）；路径集合变化或整页重挂才会再探。失败时已渲染的缓存批次保留。
- `probeWorkspaceGit` 的失败形状合并：原先"toplevel 成功但 common-dir 失败"的中间态不再可区分（整条 rev-parse 非零即 undefined）——该中间态原本也只映射为 undefined，无行为损失。
