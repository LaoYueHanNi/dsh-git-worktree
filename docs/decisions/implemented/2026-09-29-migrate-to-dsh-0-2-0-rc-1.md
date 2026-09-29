# DR: 适配宿主 dsh 0.2.0-rc.1（最小依赖锁定 rc.1、双端零代码适配、补显式 code-language 依赖）

Status: implemented

## Problem

### 1. 宿主 0.2.0 线发布，插件依赖断代

宿主 dsh 已发布 `0.2.0-rc.1` 与 `0.2.0-rc.2`（git tag `dsh-v0.2.0-rc.1`、`dsh-v0.2.0-rc.2`，两者间隔 187 个提交）。插件 peer/dev 依赖仍锁 `^0.1.7-rc.1`，在 0.2.0 宿主上会被兼容性预检（`compatibility-preflight`，0.1.7-rc.1 起存在且两段区间零变化）判定为版本不符而拒绝加载，需要抬升依赖线。

### 2. 最小依赖选 rc.1 还是 rc.2 取决于两 rc 之间有无破坏

发布计划要求最低依赖压到 `0.2.0-rc.1`，前提是 rc.1 → rc.2 对插件 API 面无破坏性变更；该前提需要逐包 diff 验证而非假设。

### 3. 0.1.7-rc.1 → 0.2.0-rc.1 的跨越同样需要验证

抬最低版本不是只改数字：插件编译与测试必须真实跑在 rc.1 上，且要确认这段大版本迭代里插件用到的符号没有被删除或改签名。

## Decision

插件整体升级适配宿主 `0.2.0-rc.1`，peer 覆盖到 rc.2 及 0.2.0 正式版，具体落地如下：

### 1. 依赖声明：peer 范围化、dev 精确化

1. `peerDependencies`：`dsh-host-webserver`、`dsh-settings` 升为 `^0.2.0-rc.1`（semver 同元组 prerelease 递增落在该范围内，天然覆盖 `0.2.0-rc.2`）；`cordis` 升 `^4.0.4`、`schemastery` 升 `^3.18.4`（0.1.7-rc.1 起宿主 vendor 搭配即为 4.0.4/3.18.4，此处是对齐而非追赶）。
2. `devDependencies`：20 个 `dsh-*` 包由 `^0.1.7-rc.1` 改为**精确 `0.2.0-rc.1`**。精确锁定的目的是让 typecheck/test 的绿灯证明"最小依赖 rc.1 可编译可运行"，而不是被范围内更新的 rc.2 掩盖。
3. `pnpm-workspace.yaml` 的发布年龄豁免清单同步替换为 `0.2.0-rc.1` / `cordis@4.0.4`。

### 2. 双端 API 面逐包验证，零代码适配

对照插件实际导入的 18 个包/入口逐包 diff 验证（符号级，非文件级）：

1. **0.1.7-rc.1 → 0.2.0-rc.1**：`vendor/cordis`、`vendor/schemastery`、`dsh-host-webserver`、`dsh-settings`、`ui-slots`、`ui-renderer`、`ui-session`、`client-connection`、`api-gateway` 源码零 diff；`SessionId`/`WorkspaceId`/`SessionSummary` 字段/`ConfigForm`/`PluginConfigViewProps`/`conversation.input.left` 契约逐字一致。区间内 3 处破坏均落在插件未用的符号上：`workspaces.initializeDefault` 删去 request 参数、`uiWorkspace.forkSession` 返回值收窄、`ui-primitives` 删除 `OnboardingSurface`。插件用到的 `create/list/archiveSession/delete`、`startSession`、`webServer.register`、`settings.configure`、`configForms.get/describe`、`locale.register` 全部签名未动。
2. **0.2.0-rc.1 → 0.2.0-rc.2**（187 提交）：对插件 18 个入口的 diff 中，插件相关符号变化为零；ui-primitives 仅新增 `MenuGroup` 与图标路径微调，`plugins.bundle.config`/`conversation.input.left`/`settings.section`/`webServer.register`/`volatile`/`LocaleNamespaceMap` 等协议字符串在相关目录 diff 中零触及。宿主兼容性预检代码两 tag 零变化。
3. 结论：src/ 目录一行不改，typecheck、build、test 全绿即为验收。

### 3. 补显式声明上游拆包产生的新传递依赖

`ui-primitives` 在 0.2.0 把文件名→语言映射表拆为新包 `@deepseek-ai/dsh-util-code-language`，并（沿其 monorepo 惯例）声明在自己 devDependencies 里——宿主 monorepo 内靠 workspace 链接解析无感，独立插件工程在 pnpm 隔离环境下测试时解析失败（2 个测试套件 `Cannot find package`）。在插件 devDependencies 显式补 `@deepseek-ai/dsh-util-code-language@0.2.0-rc.1`，与 0.1.7 迁移时补 `dsh-util-workspace-path`/`zustand`/`immer` 同一处理。

### 4. 文档门槛与发布

README 双语的宿主版本门槛由 0.1.7-rc.1 更新为 0.2.0-rc.1；版本号升 0.4.7 由独立 chore 提交承载，tag 随该提交。

## Alternatives considered

- **devDependencies 用 `^0.2.0-rc.1` 跟随最新**：pnpm 会解析到 rc.2，绿灯只能证明 rc.2 可用，"最小依赖 rc.1"沦为未验证的假设；一旦 rc.2 引入插件误用的新 API，rc.1 用户装上即崩。精确锁定把验证力留在最小版本上，故不取。
- **最低依赖直接抬到 0.2.0-rc.2**：rc.1 → rc.2 验证为零破坏后，抬高下限只会无理由排除 rc.1 宿主用户，收窄兼容面。故维持 rc.1。
- **顺手采用 0.2.0 新能力（`data-modal-autofocus`、`backdropBlur`、`ctx.pluginNavigation.openBundle`、新 sidebar row slot）**：Modal 既有 props 完全兼容，新能力是增强不是升级所需；混入会扩大本次变更的回归面。留给后续功能提交。

## Consequences

### 收益

1. 插件进入 0.2.0 宿主线：rc.1 与 rc.2 双版本下加载、路由、设置卡片、侧栏分组全功能可用，peer 预检自然通过。
2. 最小依赖 `0.2.0-rc.1` 经过真实编译与测试验证，而非纸面推断；后续 0.2.0 正式版发布无需再次抬线。
3. 双端（host tsc + client tsdown）零代码适配，升级回归面只剩依赖解析与 Modal 运行时行为，可控。

### 代价

1. 插件不再兼容 0.1.7 宿主（延续历次硬切惯例，`@dsh-alpha` 通道模式不适用于 0.1.x → 0.2.0）。
2. 独立工程需持续跟踪上游"声明在 devDependencies 的运行时依赖"（现已有 `client-store`、`util-workspace-path`、`util-code-language` 三例），上游若继续拆包会再出现同类缺失，表现为测试期 `Cannot find package` 而非类型错误。
