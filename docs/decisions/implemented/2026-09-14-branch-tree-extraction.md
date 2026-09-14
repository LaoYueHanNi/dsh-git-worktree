# DR: 分支树逻辑外置到 branch-tree.ts——组件不可渲染，纯逻辑必须出走才有覆盖

Status: implemented

## Problem

本仓库的测试跑在独立 vitest 里，**渲染不了任何组件**：DSH 客户端包是 `window.__ModuleLoader__` 注册式 bundle，只在 dsh web 宿主内执行（[jsx-order.spec.ts](../../../tests/jsx-order.spec.ts) 头注释已记下这条约束，那两道静态门禁正是它的产物）。这意味着一条硬规律：**住在组件函数体里的逻辑，天然零覆盖**。

`BranchMenu.tsx` 把它唯一真正棘手的逻辑全放在模块作用域但不导出：`groupRows`（单 remote 前缀剥离与显示名↔动作名往返）、`buildTree`（'/' 前缀树、分支兼文件夹、文件夹优先排序、自底向上计数）、`collectFolderPaths`、`chainExpanded`。这几个函数的输出被搜索集合、展开全部的作用域、键盘走位、右键菜单的动作名三处同时读回——恰恰是坏了会静默错、而不是崩的那种。同一轮 review 在这个文件里抓到两个行为缺陷，都与派生集合有关，而它们一行测试都碰不到。

同文件还积着三处纯重复：三个浮层（确认/创建/重命名）的 `useLayoutEffect` 各约 40 行，除触发条件、setState 目标与垂直锚点外逐行相同；管理弹窗里 `face.workspaces().find(...)` 内联三次（行数 × 工作区数）；一份 "Search-field ref callback" JSDoc 被完整复制了两遍。

## Decision

- **抽 `src/client/branch-tree.ts`**：`BranchRow`、`TreeNode`、`BranchGroups`、`groupRows`、`buildTree`、`collectFolderPaths`、`chainExpanded`、`segCmp`、`groupKey` 整体搬出，**零行为改动**。`BranchMenu.tsx` 原样 re-export `BranchRow`——`BranchChip.tsx` 的 `import { BranchMenu, type BranchRow } from './BranchMenu.tsx'` 不动：这次拆分是"逻辑去哪才测得到"的内部安排，不是对调用方新增的模块边界。
- **配 `tests/branch-tree.spec.ts`（19 例）**，只打那些会静默错的边界：线性链压缩与自底向上计数、**分支同时是文件夹**（`feature` 与 `feature/x` 并存，节点必须同时带 leaf 和 children 且把自己计入 total）、文件夹优先 + 自然序 + 大小写不敏感排序、单 remote 剥前缀与 `remoteNameMap` 往返、多 remote 保留全名、无斜杠远程名不误剥、空段（`feat//x`）在 `buildTree` 与 `chainExpanded` 里的一致处理、`collectFolderPaths` 的渲染顺序、`groupKey` 的 local/remote 命名空间隔离、`groupRows` 不改调用方的行对象。
- **抽 `useFlyoutPlacement`**：把三处放置 effect 合成一个 hook，差异收敛为一个 `verticalAnchor` 参数（确认浮层给"被选中那一行"的盒子，另两个传 null = 以卡片自身居中）与一个 `deps`（重新选行要重放）。净减约 80 行。
- **管理弹窗的工作区查找改 `Map`**：`useMemo` 建 `pathKey → workspace`，三处内联 find 与死代码 `workspaceIdOf`（从未调用）一并清理。
- **静态门禁扩面**：`jsx-order.spec.ts` 的 `WATCHED` 加入 `BranchMenu.tsx` 与 `WorktreeManagerModal.tsx`——前者在 render 期构建大量 JSX（行渲染器、`ctxItems` 数组），正是该门禁防的形态。扫描结果：两文件均无既有违规。
- 顺带清掉重复 JSDoc、`.chip:first-child`（分段控件时代遗留，圆角实际由 `.dock` 的 `overflow: hidden` 负责）、`.toggleNote`（唯一用处随文案合并消失）与两处过时/中英混排注释。

## Alternatives considered

- **引入 jsdom 渲染 BranchMenu**——真正的出路是能渲染，但拦路的不是缺 DOM，是 DSH 客户端包的加载形态（`window.__ModuleLoader__` 注册 bundle）。要跑起来得给每个 primitive 打桩，桩一旦走形，测试保的就不是真实行为了。放弃，沿用既有策略：**纯逻辑外置 + 静态门禁**，两条都不需要运行组件。
- **让 `branch-tree.ts` 成为对外的正式模块边界**（`BranchChip` 直接从它 import `BranchRow`）——调用方视角里行类型本就属于"分支菜单"，为一次内部拆分去改它的 import 是把实现细节泄漏成 API。放弃，用 re-export 保持外部形状不变。
- **只补测试、不搬家**（把函数 export 出来供测试导入）——能拿到覆盖，但等于承认组件文件是个杂物袋；而这几个函数与 React 没有任何关系。放弃，搬出去顺带让 `BranchMenu.tsx` 短了 160 行。
- **`useFlyoutPlacement` 把菜单（`ctx`）也收进去**——菜单的放置姿势看着像第四个成员，但它的策略是相反的：浮层在滚动/缩放时**重新放置**，菜单**撤销**（见 [右键菜单三项补齐](2026-09-14-context-menu-affordances.md)）。硬塞进同一个 hook 只会多一个布尔开关来表达"反过来"。放弃，菜单保留自己的 effect。

## Consequences

- 得：分支树从零覆盖变成 19 例覆盖，同轮修掉的两个派生集合缺陷有了回归兜底；`BranchMenu.tsx` 净减约 240 行（逻辑外迁 160 + 浮层定位 80）；管理弹窗的查找从"行数 × 工作区数"降到常数；门禁覆盖的组件从 4 个到 6 个。
- 代价：多一个模块与一层 re-export（读 `BranchRow` 的定义要多跳一次）；`useFlyoutPlacement` 的 `deps` 是展开进依赖数组的 rest 参数，调用方必须传定长数组（三处都是字面量，但这是个没有类型能表达的约定）。
- 边界：测试覆盖的是**纯函数**，组件把它们接起来的那一段（哪个集合喂给搜索、哪个喂给渲染）仍然只有 typecheck 与静态门禁把关——review 抓到的正是这一层，它在本仓库的测试形态下依旧不可测；`branch-tree.ts` 的 `buildTree` 保留了原有的 `as unknown as TreeNode[]`（构建期用可变节点，收尾后形状等价），搬家不改行为的口径下不动它。
