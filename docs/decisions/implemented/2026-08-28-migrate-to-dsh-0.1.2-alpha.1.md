# DR: 迁移到宿主 dsh-v0.1.2-alpha.1（uiWorkspace 服务与类型链分层）

Status: implemented

## Problem

宿主 0.1.2-alpha.1 三处破坏命中本插件：(1) `workspaces` 客户端服务被重写为纯 Workspace 行，`startSession`/`pickDirectory` 迁至新服务 `uiWorkspace`——本插件的核心流程 `adoptWorktree`（`ctx.workspaces.create` 后 `startSession` 跳转）与配置卡浏览按钮都在旧方法上，升级宿主后点击即抛 `TypeError`；(2) `@deepseek-ai/dsh-client-runtime` 整包删除，但 `SettingsScope` 契约与 slots/sessions/connection/remote 等服务的 Context 声明在旧世界全部住在该包；(3) peer `^0.1.0-rc.7 || ^0.1.1-rc.2` 在 semver 预发布规则下匹配不到 `0.1.2-alpha.1`。另有环境事实：宿主 0.1.2 系 alpha **未发布 npm**（各官方包 npm 最新为 0.1.1-rc.2），devDependencies 无法直接升级到目标版本。

## Decision

仅支持 `>=0.1.2-alpha.1 <0.2.0`，放弃双版本兼容。声明面与类型面分层：peerDependencies 声明语义正确的未来（宿主 fallback 按包名 symlink、不校验版本），devDependencies 停在 npm 可安装的 `^0.1.1-rc.2`。具体：

- `src/client/index.ts`：`startSession`/`pickDirectory` 改走 `ctx.uiWorkspace`（`create` 仍在 `workspaces`，两个服务同时 inject）；`ClientContext` 改从 `@deepseek-ai/cordis` 导入。
- `src/client/ui-workspace.d.ts`：本地声明 `Context.uiWorkspace`（仅本插件用到的 `startSession`/`pickDirectory`，抄自宿主 0.1.2-alpha.1 `navigation.ts`）；宿主发包后其 `Context.uiWorkspace` merge 与本声明同名冲突即编译报错——故意的收尾 forcing function。
- `card-form.ts`/`card-form.spec.ts` 的 `SettingsScope` 保持从 `dsh-client-runtime/client` 导入（0.1.1-rc.2 可装、形状与 0.1.2 的 `dsh-client-ui-settings/client` settings-contract 同型），源码注释标明换源条件。
- 清单：`dsh.client.inject` 移除 runtime；tsdown `CLIENT_EXTERNALS` 对齐 0.1.2 冻结模块表（顺带移除已不在表中的 web-react/ui-attachment/schema-form）；`.npmrc` 关闭 auto-install-peers（否则 pnpm 尝试安装不可得的 0.1.2-alpha peer 直接失败）。
- devDependencies 显式化原来靠传递链的 `dsh-settings`/`schemastery`/`react-dom`（重装即断链）。
- 新增 `tests/client-apply.spec.ts`（FakeCtx mock）守护两条调用链：adoptWorktree = `workspaces.create` → `uiWorkspace.startSession`（并断言不触碰旧 `workspaces.startSession`）、浏览按钮委托 `uiWorkspace.pickDirectory`；vitest 需 `server.deps.inline` 内联 `@deepseek-ai/*`（宿主 UI 包 lib 内含 `.module.css`，node 原生加载即抛）。版本 0.3.2 → 0.4.0。

## Alternatives considered

- **双版本特性检测**（`'uiWorkspace?'` 可选注入 + 运行时分支）——多一层分支与两套测试面，旧宿主已无在用场景；否。
- **devDependencies 写 `^0.1.2-alpha.1`**（语义一步到位）——npm 无此版本，`pnpm install` 立即 NO_MATCHING_VERSION，仓库进入任何人不可安装状态；否。
- **构建宿主 monorepo 并本地 link 真类型**（`build:lib` 全仓 tsc+tsdown 后 overrides 指向产物）——构建重、link 路径不可提交、宿主发布后仍要换回；否。
- **维持 0.1.0-rc.7 devDeps 原地迁移**——peer 警告照旧、类型比 0.1.1-rc.2 更旧，白丢一版可得的类型修正；否。

## Consequences

- 代价：0.1.2-alpha.1 之前的宿主上本插件安装即被 peer 拒绝（宽松 fallback 下核心流程与浏览按钮点击即崩）——与 0.3.x 在新宿主上的崩溃方向相反，版本断点由 0.4.0 承载；类型面部分来自 0.1.1-rc.2（SettingsScope/slots 等），0.1.2 真类型的漂移守护推迟到收尾。
- 收尾债（宿主 0.1.2 发 npm 后一次性完成）：devDeps 升 0.1.2 系、删 `dsh-client-runtime`/`dsh-api-remotes`、`SettingsScope` 换 `dsh-client-ui-settings/client` 源、删 `ui-workspace.d.ts`（漏删会因 interface merge 冲突编译报错）。
- 换来：对 0.1.2-alpha.1 宿主运行时完全正确（两条调用链有 mock 测试守护）；仓库在 npm 现实下始终可安装、可构建、可发布；冻结模块表对齐消除了三个运行时必炸的死 external。
