# DR: 插件导出 Cordis Config schema，包清单对齐官方发布约束

Status: implemented

## Problem

对照 DSH 官方教程（02-开发_Develop/01-基础/03-插件配置.md）复核插件配置约定：官方要求插件同时导出 `Config` 类型与同名 Schemastery schema，由 Cordis 在加载时校验组合行配置并填充默认值。本插件此前只导出接口并用 `apply` 顶部的手写 `validateConfig` 兜底，Cordis 感知不到配置面；`groupSidebar` 的默认值散落三处（`sectionOf` 的 `?? true`、客户端表单、settings 组装层），存在漂移风险。

同场复核包清单，另发现两处偏离官方包约束（04-开发手册/01-新增 Package）：peerDependencies 声明的 `@deepseek-ai/dsh-settings` 与 `@deepseek-ai/schemastery` 未在 devDependencies 镜像——npm 扁平布局下靠传递依赖侥幸可解析，pnpm 严格布局或独立 checkout 会直接挂；npm 包 files 把 tsdown 产出的 `lib/client.js.map` 一并发布，官方包清单要求交付产物精确、不含 source map。

## Decision

- `src/index.ts` 导出 `Config: z<Config> = z.object({ rootDir: z.string(), groupSidebar: z.boolean().default(true) })`：Cordis 加载时经它解析组合行配置并填 `groupSidebar` 默认；`rootDir` 不设 schema 默认，键缺失保持可观察，由 settings 组装层拼出默认路径。`validateConfig` 保留，继续承担 schema 表达不了的约束（rootDir 绝对路径、未知键——schemastery 对未声明键原样保留而不拒绝，手写检查仍有效）。
- devDependencies 镜像补齐 `@deepseek-ai/dsh-settings`（与 peer 同范围 `^0.1.0-rc.7 || ^0.1.1-rc.2`）与 `@deepseek-ai/schemastery`（`^3.18.1`）。
- files 增加 `!lib/**/*.map` 排除：tarball 不再携带 source map；仓库内 `lib/client.js.map` 保留用于浏览器 bundle 调试。
- 同提交顺带把十条同构的 POST 路由注册收敛为 `postRoute` helper（纯机械去重，行为不变；GET status 走 query，维持独立注册）。

## Alternatives considered

- **删掉 `validateConfig`、完全交给 schema** —— schemastery 表达不了「rootDir 必须是绝对路径」与「拒绝未知键」，删掉后这两类错误静默通过；官方教程同样把 schema 外约束放在显式 validate 层。
- **给 settings section 的 `sectionSchema` 一并加 `.default(true)`** —— settings 用户层靠「键缺失」表达回退组装层；schema 默认值会让「组装层默认」与「schema 默认」两套语义打架。官方设置卡片示例把同一 schema 传给 installSection，本插件把 Config（Cordis 面）与 sectionSchema（settings 面）拆开正是为了保住这个区分。
- **关闭 tsdown sourcemap 代替 files 排除** —— 浏览器 bundle 的线上调试依赖 `lib/client.js.map`；仓库内保留、仅 tarball 排除，两边都顾到。
- **`exports["./client"]` 补 `types` 指针（官方示例携带）** —— 本插件 client bundle 是 `dts: false` 的 lazy-CJS factory，没有类型产物可指，落空指针反而破坏解析；待有类型面时再加。

## Consequences

- 代价：Cordis 加载路径多一层 schema 解析（空配置解析为 `{ groupSidebar: true }`，与原 `?? true` 行为等价，已实测）；`pnpm-lock.yaml` 新增两条显式条目。
- 换来：组合行配置被 Cordis 标准校验、`groupSidebar` 默认值单点化；pnpm 严格布局与独立 checkout 可直接编译；npm tarball 不再携带 map。
