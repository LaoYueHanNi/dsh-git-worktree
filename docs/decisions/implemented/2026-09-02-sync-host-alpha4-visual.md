# DR: 对齐宿主 0.1.2-alpha.4 视觉体系（hairline 描边、corner-shape、elevation 卡片）

Status: implemented

## Problem

宿主 `dsh-v0.1.2-alpha.3 → alpha.4`（PR #3411，`7020c7e122`）引入体系性视觉变更：连续曲率圆角（superellipse，`corner-shape: round`）与 hairline elevation 描边——1px 边框整体降为 0.5px 且级别下移（输入/卡片 l2→l4、outline 按钮→l3），浮层卡片（Menu r12→r20、Modal r24）去边框改 `--dsw-elevation-prominent`，设置卡（PluginCard）r12→r16，圆形控件统一加 `corner-shape: round`。本插件影子替换的侧边栏（`sidebar.workspaces` 整块席位，宿主无行级/分组级 API——alpha.4 确认 native browser 组件零 diff、零新增）其 CSS 从 native `Rows/WorkspaceBrowser/SidebarRoot` 移植（见 GroupedSidebar.module.css 头注释），BranchChip 的两张自绘浮层卡片（popCard/menuCard）复刻宿主 Menu 卡片外观——宿主视觉演进后不同步，同屏就是两套风格。同时 peer 范围 `>=0.1.2-alpha.3 <0.2.0` 同时覆盖 alpha.3 与 alpha.4 两个宿主，bundle 必须在两边都体面。

## Decision

纯 CSS 对齐（18 处，四个 module.css 加 BranchMenu.tsx 头注释），不改行为、不动 TS 逻辑：

- 边框体系照宿主新规范：1px l2 → 0.5px（输入/卡片 l4、outline 按钮 l3、卡内分隔线 0.5px l2），覆盖 sidebar-rows 的 renameInput、GroupedSidebar 的 searchExpanded/renameInput、GitWorktreeCard 的 card/body/input/browse/footer/discard-save。
- 卡片圆角：设置卡 12→16（PluginCard 同步）；BranchChip 的 popCard/menuCard 照宿主 Menu 新规范 `border: 0`、r12→r20、`box-shadow: var(--dsw-elevation-prominent, var(--dsw-shadow-lv3))`。
- **elevation token 带 lv3 fallback**：`--dsw-elevation-prominent` 是 alpha.4 新 token（gradient-shadow-text.css 体系，hairline 描边由该阴影体系承载），alpha.3 宿主没有它——fallback 回退旧 shadow-lv3，代价仅是少 hairline 描边，卡片不裸奔。
- 圆形控件（28px 图标钮、搜索、清除、pending 胶囊）加 `corner-shape: round`（渐进增强，不识别该属性的浏览器无感）。
- 不动：自绘元素（checkbox 1px color-mix 描边、segmented 控件分隔竖线——宿主无对应物）；宿主 primitives（Menu/HoverCard/Modal/Toast/Tooltip/StateDot/Button）经 import 自动继承新样式，插件侧零动作。

## Alternatives considered

- **直接用 elevation-prominent，不带 fallback**——peer 声明覆盖 alpha.3，alpha.3 宿主无此 token 时 box-shadow 整体失效，浮层卡片既无描边也无阴影；否。
- **不跟随，保持旧视觉**——与宿主同屏的 Menu/Modal（r20/r24 无边框 elevation 卡）明显漂移，且影子替换的意义就是像素级贴住 native browser；否。
- **顺手补 `hasActiveSchedule` 闹钟指示**——那是 alpha.3 之前（`e841fb6049`）就落地的既存功能缺口，不属 alpha.4 对齐范畴，归 main 线修正；本分支不做（native 实现形态已在 alpha.4 Rows.tsx 摸清：行内 title 后的独立非交互元素，数据源 `projectionValues?.schedule?.length > 0`，不进 sessionStatuses 数组）。

## Consequences

- 换来：alpha.4 宿主下侧边栏、设置卡、浮层卡片与宿主原生同屏一致；alpha.3 宿主下回退行为可接受（elevation 卡少 hairline 描边但阴影仍在），peer 范围无需收窄。
- 代价：加深"移植 CSS 与宿主实现细节耦合"的既有债——宿主每次视觉演进都需手动同步（本次 18 处即该成本的一次支付）；`corner-shape` 的视觉收益依赖浏览器支持，宿主 corner-shape.css 的 token 体系不进入本插件 bundle。
