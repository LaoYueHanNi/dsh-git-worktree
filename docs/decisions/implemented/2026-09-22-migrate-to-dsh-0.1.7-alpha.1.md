# DR: 适配宿主 dsh 0.1.7-alpha.1（接入 volatile 配置范式 + 迁移 configForms 与 UI 图标 + 废除 installSection 与旧迁移）

Status: implemented

## Problem

### 1. 上游 0.1.7-alpha.1 的破坏性断代

插件此前编译并运行在宿主 dsh `0.1.6-alpha.2`（见 [DR: 适配宿主 dsh 0.1.6-alpha.2](./2026-09-19-migrate-to-dsh-0.1.6-alpha.2.md)）。宿主升级至 `0.1.7-alpha.1`（git tag `dsh-v0.1.7-alpha.1`）后，带来以下破坏性变更，导致插件在宿主环境下无法启动、编译失败或功能缺失：

1. **`SettingsProvider.installSection` 被物理删除（运行时必崩）**：上游重构设置子系统（PR #4587），彻底移除 `installSection` 机制。宿主设置服务变更为 `SettingsForms`，底层基于 Cordis Loader profile entries，通过 `@deepseek-ai/schemastery` 的 `.volatile()` 声明自动将活跃 entry 的配置投射为设置表单。旧代码调用 `installSection` 会直接抛出 `TypeError` 崩溃。
2. **缺失 `.volatile()` 声明导致配置卡片静默消失**：在 0.1.7 下，`SettingsForms` 仅识别被 `.volatile()` 修饰的 Config 字段。若 schema 缺少该声明，`SettingsForms.describe()` 将直接跳过该 entry。前端 `src/client/index.ts` 中的 `syncCardSeat()` 依赖 `describeFace.getSnapshot()` 中是否存在 `ns === 'git-worktree'` 来挂载卡片；命名空间缺失时，Plugins 详情页的配置卡片将静默不显示。
3. **客户端设置服务由 `settingsScope` 重构为 `configForms`**：上游 `packages/client/ui-settings` 废弃了 `ctx.settingsScope` 及其 `SettingsScope` 类型，统一重构为 `ctx.configForms` 与 `ConfigForm` / `ConfigFormSnapshot`。
4. **UI 原语图标命名规范调整**：`packages/client/ui-primitives` 统一移除了图标组件名中的尺寸数字（如 `IconBranchOutline16`、`IconChevronDownOutline14` 等），改为按线宽权重的 `*Regular` 与 `*Medium` 命名规范（如 `IconBranchOutlineRegular`、`IconChevronDownOutlineRegular`）。
5. **npm/pnpm 预发布版本依赖严格隔离**：`package.json` 中的 `peerDependencies` 和 `devDependencies` 锁定在 `^0.1.6-alpha.2`，在 pnpm 严格规则下无法安装与解析 0.1.7-alpha.1，且部分上游 client 包（如 `ui-primitives` 与 `client-store`）运行时 external 的依赖（如 `@deepseek-ai/dsh-util-workspace-path`、`zustand`、`immer`）未在插件 devDependencies 中显式声明，导致独立工程单元测试无法解析。

### 2. pre-0.3 历史遗留迁移逻辑累赘

插件在 `src/index.ts` 中残留了一段从 `~/.dsh/git-worktree/settings.json` 迁移到宿主设置的过渡代码。该逻辑仅针对 2026 年 8 月初的 pre-0.3 极早期版本，现已完成历史使命。在 0.1.7 宿主持久化全面转向 Profile patch 的背景下，该代码不仅每次启动做无谓的文件系统探测，还依赖了已被重构的旧设置更新链路。

## Decision

插件整体升级适配宿主 `0.1.7-alpha.1`，单向硬切升级（peer/dev 依赖均为 `^0.1.7-alpha.1`），具体落地如下：

### 1. 接入全新的 `.volatile()` Config 配置模式与设置呈现策略

1. 在 `src/index.ts` 的 `Config` schema 中，为所有用户可调配置项追加 `.volatile()` 声明（`rootDir`, `groupSidebar`, `fetchBeforeCreate`, `autoPruneWorktrees`, `keepWorktrees`, `postCreateCopyFiles`）。
2. 在 TypeScript 类型定义中，支持 `Volatile<T> | T`，并通过内部辅助函数 `readVolatile` 解包，确保运行时读取无论来自 Cordis 的 `Volatile` 实例还是测试的裸对象均能稳定获取。
3. 删除旧的 `settingsCtx.settings.installSection(...)` 调用，接入官方推荐的设置呈现策略：
   ```typescript
   ctx.inject(['settings'], (settingsCtx) => {
     settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), 'git-worktree: settings presentation policy')
   })
   ```
   声明 `auto: false`，告知宿主本插件自带专有配置卡片（`plugins.bundle.config`），无需自动生成通用表单。
4. 业务路由（`RouteDeps`）直接读取当前 `config` 或 `ctx.fiber.config`。

### 2. 客户端适配 `configForms` 与 UI 图标重命名

1. **设置表单迁移**：在 `src/client/card-form.ts` 中将 `SettingsScope` 替换为 `ConfigForm<SectionValue>`；在 `src/client/index.ts` 中将 `inject` 依赖由 `'settingsScope'` 改为 `'configForms'`，使用 `ctx.configForms.get<SectionValue>(GIT_WORKTREE_NS)` 与 `ctx.configForms.describe()`。
2. **图标统一更新**：将 `src/client/` 下所有带尺寸数字的图标导入（`IconBranchOutline16`, `IconCheckOutline16`, `IconChevronDownOutline14`, `IconChevronRightOutline14`, `IconChevronUpOutline14`, `IconCopyOutline16`, `IconEditOutline16`, `IconGoalOutline16`, `IconPlusOutline16`, `IconProjectAddOutline16`, `IconRightUpOutline16`, `IconTrashOutline16`, `IconFolderClose16`）全部替换为官方推荐的标准 `*Regular` 变体。

### 3. 彻底物理删除 pre-0.3 历史 settings.json 迁移代码

彻底移除 `src/index.ts` 和 `src/settings.ts` 中关于 `loadLegacySettings`、`planLegacyMigration`、`settingsFileOf`、`migratedFileOf` 等代码及其对应的测试用例，卸下历史包袱，仅保留纯净的 `rootDir` 路径校验逻辑与单测。

### 4. 依赖对齐与测试环境补齐

1. `package.json` 中的 `@deepseek-ai/dsh-*` peerDependencies 与 devDependencies 全部升级至 `^0.1.7-alpha.1`，`@deepseek-ai/schemastery` 升级至 `^3.18.3`，`@deepseek-ai/cordis` 升级至 `^4.0.3`。
2. 在 `devDependencies` 中补充 `@deepseek-ai/dsh-util-workspace-path`、`zustand`、`immer`，满足独立仓库在 pnpm 隔离环境下的单元测试与构建需求。
3. 严格遵循规则：**保持 package.json 的自身版本号（version 字段）在 0.4.5 不变**，发版升号由用户后续发起独立 chore 提交。

## Alternatives considered

- **做 0.1.6 与 0.1.7 双版本运行时动态兼容**：上游处于 alpha 快速迭代期，相邻版本不承诺向下兼容；双版本不仅无法规避 pnpm 对 alpha peerDependencies 的严格校验冲突，还会导致代码中充满不可测的动态探测逻辑，维护成本高。
- **保留 pre-0.3 settings.json 迁移逻辑并适配 0.1.7 的 update 接口**：该旧文件早已在实际环境中绝迹，宿主持久化范式已迁入 Profile Patch，保留该链路只会徒增复杂度与冷启动耗时。
- **顺便利用 0.1.7 新开放的 session.menu.item 插槽开发会话右键菜单**：违背单一职责与风险隔离原则；会话右键菜单涉及新的 UI 交互、测试和国际化，已单独作为 [DR: 利用原生会话菜单插槽支持工作树行级快捷操作](../proposed/2026-09-22-session-context-menu-worktree-actions.md) 规划，升级改动聚焦消除编译与运行时断代。

## Consequences

### 收益
1. 完全消除在 0.1.7-alpha.1 宿主下的加载崩溃与设置卡片丢失问题，插件运行与配置交互无缝恢复。
2. 客户端代码与上游最新的 `configForms` 和 UI 图标设计规范完全对齐。
3. 彻底清除了无用的 pre-0.3 迁移历史代码，精简了核心逻辑与测试用例。
4. 全量编译（Host/Client）、类型检查（`tsc`）与 310 项单元测试保持 100% 绿灯。

### 代价
1. 本插件不再向下兼容 `0.1.6-alpha.2` 及更早版本的 dsh 宿主（符合 alpha 阶段硬切预期）。
2. 在独立插件仓库中额外显式声明了部分客户端间接测试依赖（`zustand`, `immer` 等）。
