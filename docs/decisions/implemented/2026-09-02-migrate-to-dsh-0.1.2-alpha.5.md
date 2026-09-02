# DR: 迁移到宿主 dsh-v0.1.2-alpha.5（input 域 owner share 让位 ui-session 标准 props）

Status: implemented

## Problem

宿主 0.1.2-alpha.3 → alpha.5 之间（全部源码变更落在 alpha.3..alpha.4 区间；alpha.4..alpha.5 对本插件消费的全部包为零源码变化，仅 78 处 package.json 版本号 bump）新增破坏命中本插件一处：composer 输入域三个 slot（`conversation.input.left` / `conversation.input.right` / `conversation.composer.dock`）的 owner share `InputZone`（携带 `session: SessionSnapshot` 与 `input: InputState`）被整体删除，输入槽位改由 ComposerBar 的 PropsRenderSlots 直接声明渲染；session 身份自此只走 `dsh-client-ui-session` 包声明合并的标准 props（`sessionId` + `useSession` 选择器 + `useProjection`）。本插件 BranchChip 的 `session` prop 正来自被删的 owner share——类型链升到 `^0.1.2-alpha.5` 后 TS2339。近破坏而未命中的：session 域 `SessionSeq`/`SessionLogOffset` 品牌化与 wire 层 `SessionWireHeader` 重排（本插件不消费 seq/wire 字段）、ui-slots 新增 keyedHooks 机制（纯增量的第二注入通道）；视觉体系（superellipse corner-shape、elevation 三件套、0.5px hairline）已由 [alpha.4 视觉对齐](2026-09-02-sync-host-alpha4-visual.md)完成，alpha.4..alpha.5 无新增。

## Decision

本分支支持面升为 `>=0.1.2-alpha.4 <0.2.0`（peer 两项），devDependencies 全量 `^0.1.2-alpha.5`，从 npm 在售的 alpha.5 产物取类型。具体：

- 下限锚在 alpha.4 而非 alpha.5：两个 tag 之间插件消费的全部包源码零差异（diff 验证），alpha.5 产物上的类型与测试验证传递覆盖 alpha.4——零差异面不是未验证面，排斥 alpha.4 换不来任何确定性收益。
- BranchChip 迁移：props 解构 `sessionId` 并经 `useSession(snapshot => snapshot.blank)` 读生命周期位，summary（`cwd`）仍走注入的 sessionsList store 不变；`session.blank` 的 5 处引用随之替换。
- `@deepseek-ai/dsh-client-ui-session` 进 devDependencies，client 入口补一条 type-only import 拉标准 props 合并——merge 声明的所有者必须进依赖闭包，否则 `skipLibCheck` 掩盖 d.ts 断链、组件处只落一个难定位的隐式 any（[alpha.3 迁移](2026-09-01-migrate-to-dsh-0.1.2-alpha.3.md)补 `dsh-client-store`/`dsh-api-remotes` 的同一教训）。
- 版本号取 `0.4.2-dsh-0.1.2-alpha.5`（独立 chore 提交），`publishConfig.tag` 已固化 `dsh-alpha` 不动。

## Alternatives considered

- **peer 下限取 `>=0.1.2-alpha.5`（只服务 alpha.5）**——沿用"不声明未直接验证的兼容面"惯例到字母；但 alpha.4 与 alpha.5 消费面零源码差异是 diff 可证的事实而非推测，alpha.5 上的验证对 alpha.4 完全等价；否。
- **兼容层探测（owner share 与标准 props 双读）**——owner share 从类型与运行时双双消失，探测分支是永远走不到的死代码；直接迁移后 session 身份来源从 composer 私有 share 转为 ui-session 公共契约，下一次 composer 内部重构不再波及本插件；否。
- **等 0.1.2 正式版再迁**——宿主 alpha 渠道是本分支存在的理由，落后两个 alpha 意味着 alpha.5 宿主用户装到类型断链的旧产物；否。

## Consequences

- 换来：类型面全量对齐 npm 在售 alpha.5 产物（typecheck 干净、194 项测试全绿）；BranchChip 的 session 身份依赖面收窄到标准 props；client bundle 重建随提交。
- 代价：alpha.4 之前的宿主（alpha.3 含）不被本分支支持，peer 直接拒绝——alpha.3 宿主继续由 0.4.2-dsh-0.1.2-alpha.3（tag `0.4.2-dsh-0.1.2-alpha.3`）服务；devDependencies 多一项 `dsh-client-ui-session`（发布类型的活依赖，非死引用）。
