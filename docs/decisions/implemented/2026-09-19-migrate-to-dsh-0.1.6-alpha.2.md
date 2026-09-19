# DR: 适配宿主 dsh 0.1.6-alpha.2（设置卡片迁 plugins 槽 + 废弃侧栏遮蔽 + 工作树存储内迁项目）

Status: implemented

## Problem

### 1. 上游 0.1.6-alpha.2 的四处断代

插件此前编译/运行在宿主 dsh `0.1.2-rc.1`（peer/dev 依赖均为 `^0.1.2-rc.1`，见 [DR: 迁移宿主 dsh 0.1.2-rc.1](./2026-09-04-migrate-to-dsh-0.1.2-rc.1.md)）。宿主 `0.1.6-alpha.2`（git tag `dsh-v0.1.6-alpha.2`）其中两处是**静默失效**——不抛错、不阻止启动，只是功能整块消失。

**① 设置卡片整条链路被替换。** `settings.plugin.item`（keyed，按设置命名空间派发卡片）在 0.1.6-alpha.2 已不存在，全仓库只剩 `packages/client/ui-settings-models/src/client/slot-contract.ts` 的一句注释提到它；声明者 `ui-settings-plugins` 不再声明该 slot。取而代之的是新包 `@deepseek-ai/dsh-client-ui-plugin-manager` 在 `main` 槽下声明的三个 slot：`plugins.item`（list，Official 分组专用）、`plugins.bundle.config`（keyed，键=组合包名）、`plugins.row.config`（keyed，键=`<包名>#<行 id>`），owner props 统一为 `PluginConfigViewProps = { view: 'summary' | 'page' }`，标题/图标/面包屑收归页面。插件在 `src/client/index.ts` 的 `ctx.slots.inject('settings.plugin.item', …)` 因此**永不触发**——存储根、清理记录、工作树管理弹窗全部消失且无任何错误提示。

**② `ctx.sessions` 收窄为纯 Session Controller。** `ISessions.open(id)` 已删除（导航归 `uiWorkspace.openSession(target)`）；`SessionListState.current` / `currentAddress` 已删除，上游改为从 `byId` 里找 `retainedBy.mainView > 0` 的行（`packages/client/ui-workspace/src/client/tree.ts` 的 `mainSessionId`）；`binding(id)` 语义收紧为"借用一个**已被 retain** 的 generation"，未 retain 时返回 undefined。

**③ 会话状态源换代。** 0.1.2 客户端 `SessionSummary.completed` 在 0.1.6-alpha.2 已删除；运行/完成未读/待交互三项改由 `ui-session` 新增的 root 标准 hook `useSessionStatus`（`SessionStatusSnapshot = ReadonlyMap<SessionId, { running, pendingInteraction, completionUnread }>`）统一提供。

**④ 上游侧边栏自带「按工作区树」。** `SessionGroupBy` 从 `'workspace' | 'flat'` 扩为 `'workspace' | 'workspace-tree' | 'flat'`，实现是按**已注册工作区的规范路径做祖先前缀推断**（`tree.ts` 的 `owningParentFolder`），不扫描文件系统、不读 git、不显示分支、不解析符号链接别名。

已逐一核对**未**断代的部分：`ctx.slots` 全部核心 API 与 priority 遮蔽规则（低者渲染、同 cell 同 priority 抛错）、`children` 声明语义（随 `register` 建立，与是否被选中渲染无关）、全部 `Props*` / `HostObservable` 类型、`ctx.settingsScope.bind` 及其快照形状、`ctx.locale.register`、`ctx.remote.$host`、`ctx.workspaces` 的 `list` / `create` / `rename` / `delete` / `archiveSession`、`ctx.uiWorkspace.startSession` / `pickDirectory`、`sidebar.workspaces` 与 `conversation.input.left` 的声明、Host 侧 `SettingsProvider.installSection` / `describe` / `update`、`ctx.webServer.register({ kind: 'exact', path, handler })`、`dsh.bundle.patch` 与 `window.__ModuleLoader__.load` 契约、冻结平台模块表（新增 `dsh-client-ui-dockkit`，插件未使用）。

### 2. 遮蔽策略的承诺条件并未满足

[DR: 侧边栏按仓库聚合工作区](./2026-08-31-sidebar-workspace-grouping.md) 的问题陈述写着"DSH 原生没有层级/分组工作区概念，也不开放多工作区聚合接口"，其 Alternatives 末条承诺"官方接口一旦开放，改用原生实现"。

核实 0.1.6-alpha.2：**层级**这一半开放了，但形式是"路径祖先 + 父节点必须是真实注册的工作区"；**多工作区聚合接口没有开放**，slot 树里不存在工作区行级扩展点，`sidebar.workspaces` 仍是 `single` 整块；**store v5 仍未开放**，`createWorkspaceViewStore()` 依旧是 ui-workspace 条目的 exclusive store seat。

因此本次调整的性质是**主动放弃该特性**，而非兑现上游承诺。

### 3. 集中存储与上游层级推断错配

插件原本的默认存储根是 `~/.dsh/gitworktree`（`src/settings.ts` 的 `resolveRootDir`），而 worktree 的源仓库在别处（如 `D:\Code\*`）。上游的 `owningParentFolder` 只做路径前缀比较，**不可能**把 worktree 归到其源仓库下（实测三个 worktree 全被归到 home 节点之下，丢失"属于哪个仓库、在哪个分支"的语义）。

## Decision

插件整体迁移到宿主 `0.1.6-alpha.2`，peer/dev 依赖均为 `^0.1.6-alpha.2`，分四步落地。

### A. 废弃 `sidebar.workspaces` 遮蔽

移除了 `priority: -1` 的占用者注册，左侧浏览区交还原生 `ui-workspace`。删除 `GroupedSidebar.tsx` + CSS、`sidebar-rows.tsx` + CSS、`sidebar-groups.ts`、`sidebar-search.ts`、`pick-flow.ts` 及其三个 spec；`src/client/index.ts` 删除座位生命周期全链（`registerGroupingSeat` / `syncGroupingSeat` / `waitForGroupingSeat` / `waitSnapshotMatches` / `groupingMatches` / `afterPaint` / `finishSeat`）与 `sidebar.workspaces.directoryFlow` 的本地类型声明；`card-form.ts` 删除 `groupSidebar` 开关（`SwitchField`/`switchFailed` 机制因另两个开关保留）；locales 删除侧栏遮蔽全部词条。`sidebar-search.ts` 的 `timeLabel`/`relativeTime` 及其类型先拆入新文件 `src/client/relative-time.ts`（`GitWorktreeCard` 与 `WorktreeManagerModal` 共用；翻译类型窄化为 `time.*` 六键——`time.ago`/`hover.created`/`date.ymd` 只随侧栏的 `hoverTimeLabel` 消失）。`GroupedSidebarInjected` 类型原本就定义在 `GroupedSidebar.tsx` 内（并非任务描述所记的 `slots.ts`），随文件消失，`slots.ts` 整体未动。Host 侧 `Config.groupSidebar` 字段保留不动（无消费者，已存用户值无害）。`sessions.open` / `sessions.binding` 的全部调用点本就在 `injectFace` 内，`SessionSummary.completed` / `pendingInteraction` 的读取点全在被删的侧栏文件内——断代 ②③ 的迁移面因此几乎归零。

### B. 工作树存储内迁到项目内

新建 worktree 落在 **`<repo>/.dsh/gitworktree/<branch>`**（`<repo>` 取 `facts.repoRoot`）。路径前缀即源仓库路径，上游的 `owningParentFolder` 天然把它归到仓库下。`handleCreateWorktree` 三处 target（普通/cutout 自定义名/cutout 后缀游走）与后缀游走的落盘探测同步改写；`mkdir` 走 `RouteDeps.mkdirRecursive` seam（与 ensure-directory 同一出口）。

**忽略机制**：`src/git.ts` 新增 `appendWorktreeExclude(seams, repoRoot)`，在创建**之前**幂等地向 `<repo>/.git/info/exclude` 追加一行 `/.dsh/gitworktree/`（读全文按行判重；文件非空且无尾换行先补 `\n`；`info` 目录先 recursive mkdir；纯追加绝不覆盖——`git init` 自带的注释模板原样保留）。规则只写 `/.dsh/gitworktree/`，不写 `/.dsh/`，项目级 `.dsh/` 配置仍可提交。写入失败不阻塞创建（worktree 无法回滚），错误以 `excludeWarning` 挂在创建响应上，client toast 点名（`BranchChip` 照 `fetchWarning` 模式）。**先写规则再建目录**：写成功而创建失败的规则无害，反之会留下"已建成但 git status 脏"的窗口。`probeRepo` 的 `resolve(path, commonDir.trim())` 保持不动（天然兼容主仓库相对 `.git` 与 linked worktree 绝对路径两种 `--git-common-dir` 形态）。

### C. `rootDir` 只读 + 新旧并存

不迁移已有 worktree（会话 header 的 cwd 是 immutable，三条迁移路都被否决，见 Alternatives）。`SectionConfig.rootDir` 与 `Config.rootDir` 保留，`validateRootDir` 继续校验既有值；设置卡片改为只读展示历史位置（显示值取 `/worktrees-all` 响应新增的 `legacyRoot`——host 解析的绝对路径，覆盖"继承默认"的情况；目录不存在时经 `legacyRootExists: false` 显示"未使用（历史位置为空）"，不隐藏），`overridden`（用户层自定义）标记保留。

**并存地基**：`src/git.ts` `addWorktree` 的分支复用逻辑不动——按分支名在仓库级 `git worktree list` 中查找已有注册并复用（与目录位置无关），同一分支永远只有一份 worktree，旧位置已有的直接返回旧路径。**门控三处**（`/purge`、`/ensure-directory`、`/exists` 的 rebuildable）从"直接位于 rootDir 内"扩为"或位于 `<repo>/.dsh/gitworktree` 直接子级且 `<repo>/.git` 存在"——用目录结构反推归属（`routes.ts` 的 `insideProjectLayout`），纯 fs 判定、无需请求体携带仓库列表。

**配套**：`/worktrees-all` 改双源扫描——请求体新增可选 `workspaces`（client 传 `ctx.workspaces.list` 的 path 集合），host 对其逐个 `probeWorkspaceGit` 去重得仓库根集合，逐仓库扫 `.dsh/gitworktree`；legacy 源照旧扫 `rootDir` 直接子目录。每项带 `source: 'legacy' | 'project'`，两源各受 `SCAN_CHILDREN_LIMIT`（512）截断保护，批处理沿用 `GROUP_BATCH_SIZE`。自动清理（`pruneWorktrees`）与管理弹窗的数据源同为此路由，双源自动生效；弹窗经 `scan-groups.ts` 按来源分组（project 在前、legacy 在后、orphans 殿后，组头带来源徽标）。侧边栏零改动：旧工作树是普通注册工作区，交给原生浏览器自然展示。

### D. 设置卡片迁到 `plugins.bundle.config`

注册键取本包名 `@laoyuehanni/dsh-git-worktree`（slot 契约注释 "keyed by the bundle's package name"，渲染侧 `renderSlot(..., { entryKey: pkg.name })` 原样派发，与 `cordis.patch.yml` 的 name 一致）。`GitWorktreeCard` 按新 owner 契约改写：`view === 'summary'` 在组合包行渲染一行简介（复用 `cardDescription`），`view === 'page'` 渲染表单本体，不再自绘折叠行外壳、标题与图标；`card-form.ts` 的暂存/revision 设栅逻辑保留（只剩 keep 字段）。注册条件照 `ui-settings-plugins` 的模式：订阅 `ctx.settingsScope.describe()`，仅当快照的 `view.namespaces` 含 `git-worktree` 时 `ctx.slots.inject('plugins.bundle.config', …)`，命名空间消失即注销——Host 未组装 `git-worktree` 的部署不留痕迹。type-only 依赖由 `@deepseek-ai/dsh-client-ui-settings-plugins/client` 换为 `@deepseek-ai/dsh-client-ui-plugin-manager/client`。

### E. 其余适配

- `sessions.current` 唯一一处（`pruneWorktrees` 排除当前会话目录）改为 `Object.values(sessions.byId).find(s => (s.retainedBy.mainView ?? 0) > 0)?.cwd`，与上游 `mainSessionId` 同构。该改写与依赖升级、卡片迁移同一提交落地（0.1.6 类型下 `ISessions.current` 与 `settings.plugin.item` 槽名任一残留都编译不过）。
- `dsh.client.inject`：`ui-settings-plugins` → `ui-plugin-manager`，移除 `ui-sidebar`（type-only 引用已无）；`ui-settings`（settingsScope 类型）、`ui-conversation`、`ui-workspace`（`adoptWorktree` 的 `startSession`）保留。
- `tsdown.config.ts` 的 `CLIENT_EXTERNALS` 未动（0.1.6 平台表只新增 `dsh-client-ui-dockkit`）。
- 依赖细节：devDep 移除零引用的 `@deepseek-ai/dsh-workspace`（其 0.1.6 依赖链要求未发布的 `dsh-sandbox`）与仅侧栏使用的 `@deepseek-ai/dsh-util-workspace-path`、`@deepseek-ai/dsh-client-ui-settings-plugins`、`@deepseek-ai/dsh-client-ui-sidebar`。`pnpm-workspace.yaml` 落成两行配置：`allowBuilds.esbuild: true`（pnpm 11 的构建审批）与 `autoInstallPeers: false`（pnpm 11 不再读 `.npmrc` 的同名键；不关会把传递 peer 的 `dsh-sandbox@^0.1.6` 拉进解析，而 npm 上只有 alpha 预发布）。`@deepseek-ai/dsh-client-ui-primitives@0.1.6-alpha.2` 的产物 import `clsx`/`shiki`/`micromark-*`/`katex` 等约 19 个**未声明**依赖（上游把它们留在 devDeps、由宿主 bundle 提供），插件侧按上游 devDeps 版本镜像补入 devDependencies 供 vitest 的 inline 转译解析（`micromark-util-symbol` 降为 npm 实际存在的 `^2.0.1`）；不影响发布产物（primitives 在 client bundle 中本就 external）。

## Alternatives considered

- **继续遮蔽并补上"按工作区树"一档** —— 上一版的方案。否决：上游每跟一个版本就要复刻一次它的 UI，而追平的内容里有一半（目录树、拖拽排序、Schedule 闹钟、subagent 谱系指示）与本插件的 git 核心价值无关；且上游没有工作区行级扩展点，遮蔽是"整块接管或什么都不显示"的二元选择，成本只会持续上升。
- **`<repo>/.git/dsh-worktrees/`（零侵入布局）** —— 实测完全可行：root `git status --ignored` 全空、`git clean -xdn` 与 `-xdffn` 都不碰它、`git gc --prune=now` 安全、`git worktree remove` 正常、路径归属成立、不嵌套，**一行 ignore 都不用写**。用户实机试用后否决：worktree 对用户不可见（`.git` 是隐藏目录，IDE 不索引），且从 worktree 向上走一级就是 `.git`（`objects/` / `refs/` / `config`），对 agent 场景是真实误操作风险。
- **`<repo>/.dsh-worktrees/`（换个目录名以精确忽略）** —— 曾建议用它规避"忽略整个 `.dsh/`"的副作用。否决：`/.dsh/gitworktree/` 本身就能精确忽略，`.dsh/` 下其他内容不受影响，无需另起名字；且 `.dsh/gitworktree` 与插件全局默认 `~/.dsh/gitworktree` 语义一致，用户看到路径就知道是谁建的。
- **迁移已有 worktree 到项目内** —— 曾作为需求提出，评估后放弃。三条路都不可接受：*改写会话 cwd* 不可行（`SessionHandle.header` 在 `packages/session/session-persistence/src/handle.ts` 明确 immutable，会话日志是 append-only 事件流，改写即篡改历史）；*迁移 + junction/symlink 桥接* 技术可行但要求旧路径链接永久保留，与"废弃 rootDir"矛盾；*迁移 + 重建工作区* 会丢会话归属。并存方案以零迁移成本覆盖了同一需求。
- **保留 `rootDir` 可编辑** —— 意味着用户能把新建位置指回集中存储，插件要长期维护两条新建路径与两套扫描语义。否决：只读 + 兼容旧位置已覆盖存量用户。
- **为孤儿 worktree 维护"曾见过的仓库根"记忆** —— 某仓库的所有工作区被删除后其 worktree 会扫不到。与插件"零持久化状态"原则冲突，用户接受该边界并写入文档。
- **注册 `plugins.item`（list）而非 `plugins.bundle.config`** —— 该 slot 是 **Official** 分组专用，第三方插件占位会误导用户。否决。
- **注册 `plugins.row.config` 而非 `plugins.bundle.config`** —— 渲染同一份表单，但行配置把入口缩成该行的一个"配置"控件；bundle 配置直接落在组合包页面上，更贴"本插件只有一份全局配置"的形状。将来需要按行区分时再迁。
- **本轮顺带 bump `package.json` version 并发布** —— 发版升号由用户发起且应作独立 chore 提交；本轮只切兼容面。否决。

## Consequences

**所得**：
- 插件完整运行在宿主 0.1.6-alpha.2 上：Plugins 页打开本组合包可见 summary/page 两态卡片（只读存储根、清理记录、工作树管理弹窗），Host 未组装 `git-worktree` 命名空间时无任何痕迹。
- 侧栏回到原生 `ui-workspace`：工作区树、拖拽排序、Schedule 标识、subagent 谱系活动指示、"添加工作区"入口全部可用，插件不再追平上游 UI。
- 新建 worktree 落在各仓库内，源仓库 `git status` 干净、`git add -A` 不含该目录（实测：`git check-ignore -v` 命中；worktree 内部独立提交不受干扰），上游工作区树自动把它归到源仓库之下——不需要插件参与分组。
- 同一分支永远只有一份 worktree（旧位置已有的被 `git worktree list` 级复用），管理弹窗同时列出新旧两处并能区分来源，`ensure`/`purge`/rebuildable 对两处生效，自动清理跨两处按全局配额工作。
- 删除工作树保留双入口且语义单一：管理弹窗的行按钮 + 分支菜单「工作树」分组的行右键（2026-09-19 补充：遮蔽删除后原生侧栏右键只剩宿主的「删除工作区」——0.1.6 的 `ui-workspace` 契约只有两个 directoryFlow 单洞、无行级菜单 slot，注入原生菜单只能重回整体遮蔽，故不加）。两处都走共享的 `removeWorktreeFully`（git 先删、归档会话、注销工作区，分支保留），确认弹窗列出未提交数/领先提交数/将归档会话数，运行中会话禁用删除。

**代价与边界**：
- 侧栏不再有"按 git 仓库聚合"这一层；存量 worktree 的归属信息只能靠会话内的 `BranchChip` 与分支菜单读取，旧位置的工作树在上游树里仍挂到 home 或独立展示（新建的才归位）。
- `<repo>/.dsh/gitworktree/` 虽被本地忽略，但确实存在于工作区目录中：备份/同步工具会把它一起备份；用户手改 `.git/info/exclude` 或换机器时忽略规则不跟随（规则不进版本控制，也不影响协作者）。
- `git clean -xdff`（双 `-f`）会删掉项目内的 worktree 目录（单 `-f` 会 skip 嵌套仓库）；删后 `git worktree prune` 可自愈注册，但未提交内容会丢——已写入 README 注意事项。
- 孤儿 worktree（某仓库的全部工作区被删除后）不再出现在扫描结果中——管理弹窗看不见、自动清理管不着；已接受并写入文档。
- 双源扫描比"扫一个根"贵：每仓库一次 `listDir` + workspace 集合一次探测，仓库数量大时 git spawn 增长，沿用批处理与 512 截断保护兜底。
- 上游 alpha 的两处打包瑕疵由插件侧吸收：primitives 产物携带约 19 个未声明依赖（镜像进 devDeps 供测试转译）；`pnpm-workspace.yaml` 承接 pnpm 11 的构建审批与 peer 安装开关。上游若在正式版修复，devDeps 清单可收缩。
