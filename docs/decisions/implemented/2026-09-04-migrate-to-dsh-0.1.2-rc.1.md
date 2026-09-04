# DR: 迁移宿主 dsh 0.1.2-rc.1（settings 服务方法化 + client 类型链 + uiWorkspace / $host）

Status: implemented

## Problem

插件运行在已发布的宿主 dsh `0.1.2-rc.1`（npm；git tag `dsh-v0.1.2-rc.1`）上，而 main 的 `@deepseek-ai/*` 依赖与源码仍停在 `0.1.0-rc.7` / `0.1.1-rc.2`。对本插件会编译/运行失败的断代有：`dsh-settings` 删除顶层 `installSettingsSection` / `settingsNamespace`，改由 `SettingsProvider.installSection` 吃普通字符串命名空间；`dsh-client-runtime` 整包删除，client 类型链与 `workspaces.pickDirectory` / `startSession` / `connection.hostDescription` 悬空。npm `@dsh-alpha` 已发布 `0.4.3-dsh-0.1.2-alpha.5`（以它为适配蓝本），本地 `feature/0.1.2-alpha.3` 停在 0.4.2 基线、落后 main 的启动提速 / Config schema / README 精简 / lib 不入库，不能 merge。alpha.5 → rc.1 宿主消费面源码相同（tag 之间仅版本号 bump）；官方 ui-workspace 的 `hostInfo` 失效源已是 `connection/reset`，不是 alpha.5 用的 `connection.generation.subscribe`。

## Decision

在 main 上一次提交手工移植 rc.1 真实面上的适配，不 bump `package.json` version（仍为已发布的 `0.4.3`）：

1. **settings**：`GIT_WORKTREE_NS` 改为字符串 `'git-worktree'`；section 注册走 `ctx.inject(['settings'], sctx => sctx.settings.installSection(ctx, ns, …))`。保留 main 已有的 `export const Config` schema 与 `postRoute`。
2. **client 类型链**：`ClientContext` 来自 cordis；`SettingsScope*` 来自 `dsh-client-ui-settings/client`；`SessionListState` 来自 `dsh-api-session-controller/client`；`WorkspaceSnapshot` / `WorkspaceId` 来自 `dsh-api-workspace-controller/client`；`SessionId` 来自 `dsh-session/types`；`ctx.slots` 来自 `dsh-client-ui-renderer/client`。BranchChip 的 `sessionId` / `useSessions` / `useSession`（`blank`）走 ui-session 标准 kit（rc.1 已把这两项加回 SessionStandardProps / GlobalStandardProps）。`dsh.client.inject` 去掉 `dsh-client-runtime`、补 `dsh-client-ui-workspace`。
3. **导航面**：inject 补 `uiWorkspace`；`startSession` / `pickDirectory` 四处改走 `ctx.uiWorkspace`。`archiveSession` 仍走 `ctx.workspaces.archiveSession`（alpha.5 已验证，`IWorkspaces` 上仍在）。
4. **Host facts**：`hostDescription` 改名 `hostInfo`；`getSnapshot` 读 `ctx.remote.$host`；`subscribe` 跟官方 ui-workspace 走 `ctx.on('connection/reset', listener)`，不沿用 alpha.5 的 `generation.subscribe`。
5. **视觉**：自绘复刻面跟宿主 0.1.2 hairline / elevation / round 对齐（elevation token 带 `shadow-lv3` fallback）。
6. **依赖**：peer/dev 的 `@deepseek-ai/dsh-*` 升 `^0.1.2-rc.1`；删 `dsh-client-runtime`；补 gateway / session-controller / workspace-controller / connection / store / renderer / workspace / session / util-workspace-path / `dsh-workspace`（`/types` 子路径，避免误加载 Host `SessionStore`）；cordis dev `^4.0.2`。`.npmrc` `auto-install-peers=false`。tsdown `CLIENT_EXTERNALS` 裁到 0.1.2 冻结平台表。
7. **发布通道**：`publishConfig` 不加 `tag: dsh-alpha`（main 是默认线）。README 默认安装面向 0.1.2-rc.1；`@dsh-alpha` 仍指向已发布的 `0.4.3-dsh-0.1.2-alpha.5`。启动快路径与 lib 不入库维持 main 现状。

## Alternatives considered

- **merge / cherry-pick `feature/0.1.2-alpha.3`** —— 侧分支停在 0.4.2，会丢掉 main 的启动提速、Config schema、README 精简；且源码落后 npm alpha.5。否决。
- **hostInfo 沿用 alpha.5 的 `connection.generation.subscribe`** —— rc.1 里 generation 仍在，但官方 ui-workspace 与 cookbook 已改 `connection/reset`；跟官方走，避免下一次宿主收掉 generation 公开面再迁一次。否决。
- **双版本特性检测（installSettingsSection 与 installSection、pickDirectory 两套并存）** —— 宿主已断代，长期两套路径不值；`uiWorkspace` 加入 inject 会让旧宿主上插件整体不启动。否决：main 不再兼容 0.1.0-rc.7 / 0.1.1-rc.2。
- **本提交升版本号并 publish** —— 发版升号由用户发起且应作独立 chore；本提交只切兼容面。否决。

## Consequences

- 代价：本线仅兼容 0.1.2-rc.1 及以上宿主；旧稳定宿主继续用已发布的 `0.4.3`。下次 publish 之前，npm `latest` 仍是旧宿主包。
- 换来：typecheck / 测试 / 双构建跑在 rc.1 真实类型上；main 业务提交完整保留；`hostInfo` 与原生浏览器同构；alpha 侧分支不再误导发布。
