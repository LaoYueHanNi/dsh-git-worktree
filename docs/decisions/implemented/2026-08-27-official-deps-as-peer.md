# DR: 官方 @deepseek-ai/* 运行时依赖声明为 peerDependencies

Status: implemented

## Problem

awesome-dsh-plugin 收录指南推荐：官方 `@deepseek-ai/*` 包用 `peerDependencies` 声明（预构建安装可免 allowBuilds 构建授权步骤）。本插件此前把 `@deepseek-ai/dsh-settings`、`@deepseek-ai/schemastery` 放在 `dependencies`：dsh profile 安装后 node_modules 里多装这两个库（插件管理页"已安装，未生效"的两个条目即它们），与宿主树内同名包双份存盘，每次安装还多下载。另注：npm 上 `dsh-git-worktree` 包名属第三方 wloops，本插件经 GitHub（`github:LaoYueHanNi/dsh-git-worktree`）分发，无 npm 发布路径。

## Decision

自 0.3.2 起，两个运行时 import 的官方包（`@deepseek-ai/dsh-settings`、`@deepseek-ai/schemastery`）移入 `peerDependencies`，`dependencies` 字段移除；dsh-settings 范围从 `^0.1.0-rc.7` 放宽为 `^0.1.0-rc.7 || ^0.1.1-rc.2`，兼容新旧宿主线（semver 预发布规则下 `^0.1.0-rc.7` 匹配不到宿主的 0.1.1-rc.2），做法与 dshmarket 一致。运行时解析依据（同作者插件 @laoyuehanni/dsh-token-usage 0.3.10 先行验证）：profile 的 node_modules 从未安装过 `@deepseek-ai/cordis`（仅 devDeps），插件 Node 侧裸导入一直正常——cordis-plugin-loader 的 require-builtins 机制把裸导入转发到宿主树解析；宿主树（全局 dsh 的 `node_modules/@deepseek-ai/`）确认存在 dsh-settings（0.1.1-rc.2）与 schemastery。安装期 pnpm 新增 unmet-peer 警告属预期噪音，与 cordis 类警告同类。

## Alternatives considered

- **维持 dependencies** —— 可用，但违背收录指南推荐，持续付出多包下载与 profile 双份存盘的代价。
- **改 optional peerDependencies（peerDependenciesMeta.optional）** —— 语义是"缺了也不报"，掩盖真实解析失败，排障更难。
- **只移 schemastery、dsh-settings 留 dependencies** —— 两者解析路径一致（都在宿主树内），部分迁移无额外安全性，反而留下双份存盘。

## Consequences

- 代价：安装输出多两条 unmet-peer 警告；若未来宿主某版本从模块表移除这两个包，缺失将在运行时（而非安装时）才暴露，届时需回退 dependencies 声明出补丁版本（回滚预案）。
- 换来：安装少下载官方库包；profile 不再与宿主双份存盘，旧库包条目随重装被 pnpm 剪除；对齐 awesome-dsh-plugin 收录指南与生态惯例（dshmarket、dsh-token-usage 同款）。
