# DR: 适配宿主菜单半透明演进（对齐权限选择与原生 Menu 标准毛玻璃材质）

Status: implemented

## Problem

宿主 dsh 近期将 `--dsw-specific-menu` 调整为半透明色值（浅色 0.58 / 深色 0.5），配套滤镜变量为 `--dsw-menu-backdrop-filter: blur(40px) saturate(150%)`，并由 `--dsw-elevation-stroke-color: var(--dsw-alias-border-l1)` 配合 `box-shadow: var(--dsw-elevation-prominent)` 提供 0.5px 发丝级描边与多阶柔光（参考 `PermissionSelect` 与 `Menu` 原语）。

在插件前端历史代码中，`src/client/BranchChip.module.css` 中的浮层（`.menuCard`、`.popCard`、`.ctxCard`）直接使用 `background: var(--dsw-specific-menu, ...)`，且未配置 `backdrop-filter` 与 `--dsw-elevation-stroke-color`。宿主升级后，半透色值缺失毛玻璃模糊，导致底层文字和界面直接穿透显现；若改用实色 `layer-2` 与 1px solid 粗边框，又会丢失与宿主输入栏并排组件（如左侧权限选择 `PermissionSelect`）统一的精致通透质感。

## Decision

将分支菜单（`.menuCard`）、操作确认对话框（`.popCard`）及行级右键菜单（`.ctxCard`）的材质与背景全面对齐宿主 `PermissionSelect`（底层 `Menu.module.css`）标准规格：

1. **补齐宿主标准毛玻璃高斯模糊**：
   - 补充 `backdrop-filter: var(--dsw-menu-backdrop-filter);`，将底层文本与杂色以 40px 高斯模糊融合，彻底解决纯透光漏底问题。
2. **重绑发丝描边色彩**：
   - 显式声明 `--dsw-elevation-stroke-color: var(--dsw-alias-border-l1);`，由 `box-shadow: var(--dsw-elevation-prominent)` 的前置描边绘制细腻的 0.5px 轮廓，保持 `border: 0`，消除 1px 实体边框的生硬感。
3. **注入高层级表面滚动条材质**：
   - 在 `.menuCard` 声明 `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);` 与 `--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);`，使长分支列表的滚动条自然融入浮层材质。

## Alternatives considered

- **改用实色图层 `var(--dsw-alias-bg-layer-2)` 与 1px 实线边框**：虽然彻底阻隔了底层，但在 composer 底部工具栏中，分支选择与左侧权限选择（`PermissionSelect`）、模式选择并排呈现。实色 + 实体边框在暗色与亮色模式下均显得突兀厚重，破坏了宿主工具栏组件群的设计一致性。
- **仅保留 `--dsw-specific-menu` 不配滤镜**：底层高对比度内容（如代码块、聊天文字）直接干扰分支名称阅读，视觉严重漏光。

## Consequences

- **收益**：分支菜单视觉表现与输入栏左侧的权限选择下拉菜单 100% 像素级对齐，兼具轻盈通透的毛玻璃模糊感与发丝级发光描边；彻底杜绝文字漏底。
- **代价**：依赖浏览器对 CSS `backdrop-filter` 的支持（宿主目标环境均满足）。
