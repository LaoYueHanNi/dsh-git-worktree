# DR: 版本 tag 触发的 npm 发布流水线

Status: implemented

## Problem

发版一直是手动流程：commit → 在发布机跑 `npm publish`，整条链依赖本机的全局 registry 配置、npm 登录态与 Node 版本；`prepublishOnly` 虽兜底"忘构建就发包"，但换机器、忘步骤仍会出事故，且版本号与 git 历史的对应关系无人校验，发出去的包难以追溯构建来源。

## Decision

新增 `.github/workflows/publish.yml`：push `v*` / `[0-9]*` 形态的 tag 触发。流程为 checkout → `pnpm/action-setup@v4`（从 `packageManager` 字段读 pnpm 版本）→ `setup-node` 22 + pnpm 缓存 → 校验 tag 名与 package.json `version` 一致（错配即报错退出）→ `pnpm install --frozen-lockfile` → `npm publish --provenance --access public`（publish 前自动执行 `prepublishOnly`：typecheck → test → build:all）；版本号含预发布段（`-`）自动改挂 `next` dist-tag，不污染 `latest`。`permissions.id-token: write` 供 provenance 签发的 OIDC。认证使用 npm granular token（限定本包 Read and write）存 GitHub 仓库 Secret `NPM_TOKEN`。发版流程固化为：bump version → commit → `git tag vX.Y.Z` → `git push origin vX.Y.Z`。本决策取代 [DR: 以 @laoyuehanni/dsh-git-worktree 发布到公共 NPM](2026-08-30-publish-to-npm.md) 中的"手动发版"方式；包名、`files` 白名单、`publishConfig`、`prepublishOnly` 等其余决策不变。

## Alternatives considered

- **workflow_dispatch 手动触发** —— 发布动作与版本号无强绑定，tag 一致性仍靠人眼；tag 触发让"推 tag"本身就是发布，且工作流内强制校验一致性。放弃。
- **semantic-release / release-please 全自动发版** —— 从约定式提交自动推导版本与 changelog，机器接管版本号节奏；单人仓库版本由维护者手工控制，引入约定解析机器复杂度不划算。放弃。
- **npm trusted publishing（OIDC 免 token）** —— 需在 npmjs.com 为包配置受信任发布者；granular token 已能把权限收敛到单包读写，provenance 照常签发，且与同账号其他插件的操作习惯一致。暂放弃，后续可迁移。

## Consequences

- 得：发布环境固定在 CI（Node 22 + 官方 registry），typecheck/test/构建全绿才发布；tag 与版本一致性由机器校验；provenance 提供可验证的构建来源；rc 版自动挂 `next`，`latest` 只收正式版。
- 代价：发版多"push tag"一步，tag 打错须删远端 tag 重打（一致性校验会先拦截错配）；`NPM_TOKEN` 是长期凭据，泄漏面在 GitHub Secret，生成与轮换由维护者自行负责，且 Secret 逐仓库单独配置。
