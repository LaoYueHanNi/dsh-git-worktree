# DR: 对齐 DSH 0.2.2-rc.5 视觉规范、原语组件与跨会话全局 Toast

Status: implemented

## Problem

在适配 DSH `0.2.0-rc.1` 至 `0.2.2-rc.5` 的过程中，客户端 UI 逐步暴露出三类一致性与体验问题：

1. **样式规范偏离 DSH 主题体系**：部分 CSS Module 引用了宿主主题中不存在的 Token（如 `--dsw-alias-label-danger`、`--dsw-alias-label-error`、`--dsw-alias-label-warning`、`--dsw-alias-surface-raised`）并依赖硬编码十六进制色值兜底；圆角存在 `5px/6px/7px/10px` 等非标中间值；标题使用了 `font-weight: 600`；`PushDialog` 目标编辑浮层同时声明了 `border` 与 `elevation` 阴影形成双重描边；删除确认按钮在管理弹窗中为危险红色，而在分支菜单浮层中固定为蓝色。
2. **手写控件与原语重复**：设置页开关、徽标、按钮以及推送/图谱弹窗的刷新图标（`↻`）、下拉箭头和复选框仍由手写 DOM/Unicode 承担；工作树管理弹窗路径使用 `direction: rtl` 截断，在 Windows 盘符与中英文混排下易触发 Bidi 错位。
3. **交互反馈存在静默缺口**：后端创建工作树返回的 `copyWarning` 未被前端消费；创建工作树跳转新会话后卸载旧 `BranchChipDock` 会吞掉局部 Toast；管理弹窗缺少刷新与「打开会话 / 复制路径」动作，且删除后重刷未同步更新 `inspectWorktree` 与运行态集合；设置页 `postCreateCopyFiles` 缺少保存前路径校验；原地切换分支、安全删分支与建树失败直接透出英文 git 原始命令输出；窄屏下提交图谱左侧分支树挤占至极窄列难以阅读。

## Decision

以最新 RC 版本 **`dsh-v0.2.2-rc.5`** 为视觉与原语基准（同时保持对 `engines.dsh >= 0.2.0-rc.1` 导出交集的完全兼容），完成以下统一收敛：

1. **视觉铁律对齐**：
   - 全量清理不存在的 Token 与硬编码色值，统一使用 `--dsw-alias-state-error-primary`、`--dsw-alias-state-warn-primary`、`--dsw-alias-state-success-primary`、`--dsw-alias-state-business-primary`、`--dsw-alias-file-diff-added-marker`、`--dsw-alias-file-diff-deleted-marker`、`--dsw-alias-bg-layer-2` 与 `--dsw-alias-link`。
   - 圆角收敛至 DSH 6 档 Token（`--dsw-radius-xs/sm/md/lg/xl`），字重不超过 `500`，浮层去除冗余 `border` 交由 `--dsw-elevation-prominent` 统一描边，`:hover` 包裹进 `@media (hover: hover)`，浮层滚动条重绑 `--dsh-scrollbar-thumb`，清理设置卡 CSS 中未引用的 `.toggleMark`/`.spinner` 死代码。
   - 删除分支与删除工作树的右键菜单项及二次确认按钮统一采用危险红语义（`.ctxItemDanger` / `.popConfirmDanger`）。
2. **复用 `@deepseek-ai/dsh-client-ui-primitives` 原语**：
   - `GitWorktreeCard` 改用原语 `Switch`、`Tag`（`tone="neutral"`）与 `Button`（`size="sm"`）。
   - `WorktreeManagerModal` 改用原语 `Tag`、`PathLabel`（替代 `direction: rtl`）以及 `IconRefreshOutlineRegular`、`IconCopyOutlineRegular`、`IconRightUpOutlineRegular`。
   - `PushDialog` 与 `CommitGraph` 用 `IconRefreshOutlineRegular` 替换 `↻`，用 `IconChevronDownOutlineRegular` 与原语 `Checkbox` 替换手写 SVG 与复选框。
3. **跨会话全局 Toast 与交互缺口修复**：
   - 新增模块级队列 `src/client/toast-bus.ts` 与 `src/client/ToastHost.tsx`，在 `src/client/index.ts` 中向宿主 `shell.overlay` 注册全局 `<WorktreeToastHost />`；若运行在不含 `shell.overlay` 的最小宿主中，`BranchChipDock` 自动回退本地 `<Toast>` 渲染。
   - `BranchChipDock` 补齐 `copyWarning` 展示，并新增 `src/client/git-error.ts` 将常见 `switch`（脏工作区/分支缺失）、`deleteBranch`（未合并/已检出）与 `worktree`（分支占用/目录已存在）错误转译为本地化提示。
   - `WorktreeManagerModal` 统一抽出带竞态序号的 `loadWorktrees`，新增顶部「刷新」按钮、行级「打开会话」与「复制路径」动作，并在删除后完整重查 `inspectWorktree` 与 `runningPaths`。
   - `CardForm` 新增与后端 `src/copy-files.ts` 同构的 `isSafeCopyRelativePath` 实时校验（阻止保存绝对路径与 `..`）及 `postCreateCopyFiles` 用户层落盘核验。
   - `CommitGraph` 与 `BranchMenu` 增加左侧分支栏收起/展开开关（视口 `<= 640px` 打开图谱时默认折叠），清理 `src/client/index.ts` 中未使用的历史路由导入。

## Alternatives considered

- **直接升级依赖至 `0.2.3-alpha.x` 并使用 `Modal tone="warning"` 或 `ui-session-panel`** —— 破坏与最新 RC（`0.2.2-rc.5`）及声明的 `>= 0.2.0-rc.1` 宿主兼容范围；采用 `0.2.0-rc.1` 与 `0.2.2-rc.5` 的公共稳定原语子集可在不抬高门槛的前提下完成视觉对齐。
- **直接强依赖 `ctx.contextMenus.notify` 替代自建 Toast 队列** —— 需在 `inject` 中引入额外必需服务，可能影响未挂载 `ui-context-menu` 的旧版或精简部署，且不如自有队列对连续多条告警（如 `fetchWarning` + `copyWarning` + `pruneDone`）的顺序展示可控；挂入 `shell.overlay` 既跨会话存活又保持零新增必需依赖。
- **仅修复 CSS Token 而不替换 `Switch`/`Checkbox`/`PathLabel`** —— 无法消除 Windows 路径 Bidi 错位与表单控件视觉割裂，且维护手写控件成本高于直接复用宿主原语。

## Consequences

- **所得**：全部弹窗、菜单、图谱与设置页在明暗双主题下与 DSH `0.2.2-rc.5` 原生风格保持一致；跨会话跳转后的建树告警、配置拷贝失败与自动清理结果不再丢失；管理弹窗形成“扫描 → 刷新 → 打开会话 / 复制路径 / 删除并重查”的完整闭环；常见 Git 操作失败提示更易读。
- **代价**：新增了 `toast-bus.ts`、`ToastHost.tsx` 与 `git-error.ts` 三个轻量前端模块，并向 `shell.overlay` 增加一个常驻空渲染的 slot 注册（队列为空时返回 `null`，运行时开销可忽略）。
