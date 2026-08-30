# DR: 以 @laoyuehanni/dsh-git-worktree 发布到公共 NPM

Status: implemented

## Problem

分发渠道只有 `github:` 直装（`dsh plugin --profile web add github:LaoYueHanNi/dsh-git-worktree`），安装绑定 git 协议与仓库可达性，享受不到 registry 的版本解析与 lock 语义。发包还受包名阻塞：registry 上裸名 `dsh-git-worktree` 已被第三方占用（维护者 wlait，latest 0.7.1，且同为面向 DeepSeek Harness 的 git worktree 插件，主题撞车加重检索混淆），沿用原名 publish 必被拒。同账号插件 @laoyuehanni/dsh-token-usage 已走通 scoped 发布流程，本插件对齐该形态。

## Decision

以 scoped 包名 **@laoyuehanni/dsh-git-worktree** 发布到公共 registry，版本沿用 0.4.0 作首版。package.json 补齐元数据：keywords/homepage/bugs/author，`repository.url` 改 `git+https://`（ssh 形式在 npm 页面无法展示）；`files` 白名单追加两份 README；新增 `publishConfig` 固定官方 registry 并声明 `access: "public"`（scoped 默认 restricted，字段兜底使任何机器上发布都不必记得加 `--access public`，registry 字段防国内镜像机器误发）；新增 `prepublishOnly` 串联 typecheck → test → build → build:client，保证每次 publish 产物新鲜且全绿。改名后的两处包名死角在同一次提交内同步（token-usage 项目 0.3.7~0.3.9 各踩一个）：`cordis.patch.yml` 的 `name` 是宿主加载插件时的 import 模块说明符，随包名改为 scoped 名；tsdown 构建把插件 id 烧进 `__ModuleLoader__.load` 注册横幅与 `data-plugin-css` 样式标签，宿主校验"注册 id 必须等于 loader 入口的包名"，故 PLUGIN_ID 改为构建时从 package.json 派生，改名不再可能失配。发版方式为手动流程：commit → `npm publish`。README 在线上验证通过后切换 npm 渠道，并在顶部放置旧 github 安装的重装指引。

## Alternatives considered

- **沿用裸名 dsh-git-worktree** —— registry 已被第三方占用（wlait，0.7.1），publish 会被拒；且对方同为 DeepSeek Harness 的 worktree 插件，即使可发也会撞检索。
- **unscoped 改名 dsh-git-worktree-plugin** —— 裸名后缀变体思路可行，但 dsh-* 命名空间已挤满功能雷同的第三方插件（dsh-usage-stats、dsh-plugin-token-usage 等），裸名易混淆劫持检索；scope 名唯一映射到发布者账号。
- **继续仅 github: 直装不分发** —— 无版本区间解析、安装受 fork/改名影响，且与宿主生态向 registry 迁移的方向相悖；token-usage 已先行验证 scoped 发布可行。

## Consequences

- 代价：包名变化要求 README 与既有用户改用新安装名。经 token-usage 项目实测，旧 `github:` 安装（依赖键 `dsh-git-worktree`）用 `update` 无法迁移：pnpm 只在原 git 渠道重新解析，且按仓库现名装出 scoped 包后宿主按 patch 的 import 说明符（`@laoyuehanni/dsh-git-worktree`）在 `node_modules` 下解析不到对应目录，启动报 `ERR_MODULE_NOT_FOUND`；按新名 `update` 则因依赖键不存在而静默无效。故 README 顶部放置重装指引（先 `remove dsh-git-worktree` 再 `add` npm 包，`~/.dsh/gitworktree/` 数据不受影响）；每次发布必须在发布机跑完整 typecheck+test+双构建（耗时换安全）；publish 者必须持有 npm 上 laoyuehanni scope 的权限；维护者本机 `web` profile 亦为 github 直装，发布后需按同一步骤迁移（同时充当真实环境验证）。
- 换来：获得 registry 的语义化版本分发与一行安装；公共包规范（许可证/元数据/入口类型声明）全部齐备；prepublishOnly 兜底使"忘构建就发包"这类事故结构性消失；PLUGIN_ID 派生化使未来改名或分叉维护不再有横幅失配死角。
