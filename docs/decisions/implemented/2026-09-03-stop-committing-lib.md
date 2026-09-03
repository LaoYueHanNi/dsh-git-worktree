# DR: lib 构建产物退出 git 仓库，关闭 github: 直装

Status: implemented

## Problem

仓库自首次发布起把 `lib/` 构建产物提交进 git，唯一目的是支持 `github:` 直装：dsh 经 pnpm 安装 git 托管插件，pnpm 默认拦截安装期构建脚本（`prepare` 等），git 安装拿不到装时构建的产物，只能依赖仓库里现成的 `lib/`。代价是双通道分发两套真相：npm 侧由 `prepublishOnly` 兜底（见 [npm 发布决策](2026-08-30-publish-to-npm.md)），git 侧没有任何机制保证 `lib` 与 `src` 同步——改了 `src` 忘记重建并提交，直装用户就拿到过期产物，且无告警。而 [npm 发布决策](2026-08-30-publish-to-npm.md) 落地后（0.4.0 改 scoped 包名、patch import 说明符随之变更），`github:` 直装本已加载失败，为它维护 14 个产物文件的同步负担已无受益者。

## Decision

`lib/` 加入 `.gitignore` 并解除 git 跟踪（`git rm -r --cached lib`），构建产物只存在于发布链路：`npm publish` 的 `prepublishOnly` 现场构建，`files: ["lib"]` 进 tarball。`github:` 直装随之正式关闭，两份 README 的 IMPORTANT 块注明仓库不再携带产物、需从 npm 安装；Development 段的「改 src 后必须重建并提交 lib」话术同步改写为「产物不入库、本地重建即可」。本决策不绑定具体版本号：落库即生效于仓库形态，对外发布节奏与版本号由后续发布决定。

## Alternatives considered

**继续提交 lib 维持 github: 直装**——对 github 用户零摩擦，但同步负担永续存在，且漂移即静默坏包；CI 校验（build 后 `git diff --exit-code -- lib`）只能拦住"忘了构建"，拦不住"构建了但没提交"，防不住人为遗漏。何况本项目 0.4.0 起 patch import 说明符已是 scoped 包名，git 直装本就加载失败，投入无回报。

**gitignore lib + `prepare` 装时构建**——仓库干净且 git 安装理论可行，但 pnpm 默认拦截 `prepare`，用户必须按 dsh 的提示手动在 profile 加 allowBuilds 再重装，首次安装必失败，体验劣于直接走 npm。

## Consequences

代价：`github:LaoYueHanNi/dsh-git-worktree` 直装无法使用（此前因改名也已不可用，实际无额外损失）；本地 `link:` 开发与临时挂载仍需手动 `npm run build && npm run build:client`（产物在磁盘、不再入库）。所得：单一分发真相（tarball 由 `prepublishOnly` 现场构建），彻底消灭 src/lib 漂移风险，仓库 diff 不再被 14 个产物文件污染，合并冲突面收窄。
