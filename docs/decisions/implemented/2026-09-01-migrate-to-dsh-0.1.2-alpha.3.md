# DR: 迁移到宿主 dsh-v0.1.2-alpha.3（settings 归宿主、Host facts 走 $host、0.1.2 发布链归位）

Status: implemented

## Problem

宿主 alpha.1 → alpha.2/alpha.3 之间（三项破坏均落在 alpha.1..alpha.2 区间，alpha.2..alpha.3 对本插件为零新增破坏）新增破坏命中本插件：(1) Host 侧 settings 安装 API 重构——包级 `installSettingsSection(ctx, …)` 与 `settingsNamespace()` 被删除，安装移到 provider 自身（`ctx.settings.installSection(owner, …)`），宿主与 hooks 形状（`validate`/`setSource`/`onChange`）不变但入口全变，本插件 host 半边无法注册 `git-worktree` namespace；(2) client 侧 `connection.hostDescription` store 整体消失，Host facts 改挂在 `ctx.remote.$host`（identity-stable 的 `RemoteHostFacts`，经 connection generation 建立），原生 Workspace 浏览器同步改为注入 `hostInfo` 钩子——本插件 GroupedSidebar 的 `home` 来源失效；(3) session 域 slot 的标准 props 收窄——`SessionStandardProps` 不再携带 `sessionId` 与 `useSessions`（sessionId 移入 owner share 的 `SessionSnapshot`，列表读取退出标准 kit），BranchChip 依赖的 `useSessions(state => state.byId[sessionId])` 编译失败。另一面是机会：宿主自 0.1.2-alpha.2 起把 prerelease 发布到 npm（alpha.3 全量在册），alpha.1 迁移决策（`feature/dsh-0.1.2-alpha.1` 分支的 `docs/decisions/implemented/2026-08-28-migrate-to-dsh-0.1.2-alpha.1.md`，本分支不含该次适配）留下的全部收尾债可以清偿。

## Decision

本分支仅支持 `>=0.1.2-alpha.3 <0.2.0`，devDependencies 全量升到 `^0.1.2-alpha.3`，从 npm 上的真实宿主产物取类型。具体：

- Host 半边：settings 安装改走 `ctx.inject(['settings'], …)` + `settings.installSection(ctx, GIT_WORKTREE_NS, schema, base, hooks)`，hooks 形状原样平移；`GIT_WORKTREE_NS` 从品牌调用降为纯字面量（`settingsNamespace` 已不存在，`installSection` 的泛型参数自带模式校验）。
- client 半边：`startSession`/`pickDirectory` 四处调用全部改走 `uiWorkspace`（alpha.1 决策定下的方向，本次全量落地）；`hostDescription` 改名 `hostInfo`，`getSnapshot` 读 `ctx.remote.$host`、`subscribe` 挂 connection 的 `generation`（方法引用包一层保 receiver，防解构丢 `this`）；BranchChip 丢弃 `useSessions`，sessionId 改从 owner share 的 `session.sessionId` 取，summary 经注入的 `sessionsList`（`ctx.sessions.list`）用 `useSyncExternalStore` 读取。
- 类型链：`SettingsScope` 归位 `dsh-client-ui-settings/client`；`SessionListState`/`SessionSummary`/`SessionSnapshot` 取自 `dsh-api-session-controller/client`，`WorkspaceSnapshot`/`WorkspaceId` 取自 `dsh-api-workspace-controller/client`，`SessionId` 取自 `dsh-session/types`，`ctx.slots` merge 由 `dsh-client-ui-renderer/client` 提供，`ctx.uiWorkspace` merge 由 `dsh-client-ui-workspace/client` 提供，`ctx.remote.$host` merge 由 `dsh-api-gateway/client` 提供——`dsh-client-runtime` 从 devDependencies 与 `dsh.client.inject` 双双移除。
- 构建面：tsdown `CLIENT_EXTERNALS` 裁剪到 0.1.2 冻结平台表（8 项中除去未用的 `dsh-client-store`）；`abbreviateHomePath` 换 `dsh-util-workspace-path` 源（不在平台表，随 bundle 内联）；`.npmrc` 沿用 `auto-install-peers=false`（宿主包 peer 是 `workspace:^`，本地装不得）。
- 发布类型依赖补齐：`dsh-client-ui-slots` 的产物 d.ts import `dsh-client-store`、`dsh-client-ui-settings` 的产物 d.ts import `dsh-api-remotes/client`——两个包必须留在 devDependencies，否则 `tsc` 侧 `skipLibCheck` 掩盖 d.ts 断链、用户代码处只落一个难以定位的隐式 `any`（本次 `GitWorktreeCard` 的 `snapshot` 参数即此路径）。
- 版本与渠道：版本号取 `0.4.2-dsh-0.1.2-alpha.3`（叠加在稳定线 0.4.2 之上的 prerelease 形式，npm 排序低于稳定版、semver 范围默认不匹配），`publishConfig.tag` 固化 `dsh-alpha`——本分支的发布绑定该渠道，`npm publish` 不带参数也落 `dsh-alpha`，永不占 `latest`；稳定线从 main 发布，不经过此固化。
- `tests/client-apply.spec.ts` 扩到 grouped-sidebar seat：断言 `startSession`/`pickDirectory` 委托 `uiWorkspace`、不触碰旧 `workspaces` 面，且 `hostInfo` 读 `$host`、订阅 generation 失效源。

## Alternatives considered

- **peer 下限放宽到 `>=0.1.2-alpha.2`**（破坏面在 alpha.2 已定形）——alpha.2 未被本分支的类型与测试覆盖，声明未验证的兼容面等于把验证责任推给用户；否。
- **维持 `hostDescription` 兼容层**（自建 observable store 包住 `$host`，组件零改动）——多一层没有第二消费者的间接，且名字继续指向已消失的宿主面，误导下一个读者；跟随原生浏览器的 `hostInfo` 惯用法后两边形状一致；否。
- **BranchChip 继续用标准 kit 读列表**（换 `useConversation`/`useInput`）——二者面向会话内容域，不提供列表行；自建注入通道与 GroupedSidebar 的 `sessionsList` 完全同构，不新增机制；否。
- **发布渠道不固化，逐次显式 `--tag`**——渠道决策交给每次发布的人肉记忆，忘带参数时 prerelease 误占 `latest`（把只在 alpha.3 宿主能跑的兼容版推成默认安装），其危害大于稳定版误入次要渠道；本分支从分支名到版本号都是纯兼容线，渠道与分支绑定才是无记忆负担的不变量；否。

## Consequences

- 换来：类型面全部对齐 npm 在售的 alpha.3 产物，alpha.1 决策的收尾债清偿完毕（`dsh-api-remotes` 除外——它从死引用转为发布类型的活依赖）；两条 uiWorkspace 调用链与 hostInfo 订阅链有 mock 测试守护；宿主侧 `installSection` 落在 settings 注入内，语义与 alpha.1 的包级安装一致（composition entry 为 base、provider 脱落时回退）。
- 代价：alpha.3 之前的宿主（alpha.1/alpha.2 含）不被本分支支持，peer 直接拒绝——alpha.1 宿主继续由 `feature/dsh-0.1.2-alpha.1` 分支服务；client bundle 因内联 `dsh-util-workspace-path` 略增（约数 KB）；`window` 计时器在 node 测试环境经 `vi.stubGlobal` 别名，与真实浏览器语义的差异由用例只触碰计时器挂载/清除的边界兜住。
