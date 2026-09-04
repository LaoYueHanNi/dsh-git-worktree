# DR: README 范围收敛为背景/功能/安装配置

Status: implemented

## Problem

README（双语各 112 行）的功能条目每条 5-10 句，塞满实现细节：git 命令与开关（`git switch -c`、`--ff-only`、`git fetch --all --prune`、dwim 语义）、路由名（`POST /inspect`）、realpath 投影、删除流程的步骤顺序——背景/功能/安装被淹没，且大量内容与 `docs/decisions/` 双写同一事实，改一处漏一处。IMPORTANT 块的旧版迁移与直装终止各带完整论证，Install 三个小节、Development 的 prepare 脚本论证重复占幅。另有两处事实漂移：legacy 设置路径写作 `~/.dsh/git-work-tree/`（实际为 `gitworktree`，见 `src/settings.ts` 的 `settingsFileOf`），测试数写作 60（实际 195）。

## Decision

对齐 dsh-token-usage 项目同日决策（其 docs/decisions/implemented/2026-09-03-readme-scope.md，本仓库外）：README 只承载项目背景、功能介绍（只讲用户可见行为，每条 1-3 句，不讲实现来源）、安装（npm 默认线面向 0.1.2-rc.1 + `@dsh-alpha` 兼容线面向 alpha 宿主，当前 `0.4.3-dsh-0.1.2-alpha.5`）/更新/移除、开发。IMPORTANT 块压缩为三段式：直装终止一句 + `add` 命令 + 旧版迁移一句指引（命令不再展开）。原 Install 的 `link:` 小节并入 Development 去重，构建块改为「构建一次、装符号链接、迭代」并挂 `link:` 安装；prepare 脚本论证压缩为一句。功能条目的实现细节全部删除——`docs/decisions/` 为唯一权威，README 不复述。两处事实漂移随重写修正；测试数改为不带数字的注释避免再过时。

## Alternatives considered

**深度细节拆 docs/ 专题文档（如 dsh-token-usage 的 pricing.md）**——该项目拆文档是因为有 `pricing.json` 格式、云端 feed、fork 镜像配置这类可配置的深度参考；本项目的深度内容纯为设计原理，无独立查阅价值，拆出去反而与决策记录构成新的双写。否决。

**README 内 `<details>` 折叠保留**——行数不减、维护面不减，只是视觉缩短，与「精简」目标矛盾。否决。

**温和精简（只砍明确的机制段落、功能条目保留机制从句）**——正文密度降不下来，读者仍需在长句里捞行为。否决（明确选择激进档）。

## Consequences

- 所得：双语各 112 行 → 97 行，英文词数 1834 → 958、中文字符 10748 → 6134（均约砍半）；功能 12 条每条可一眼读完；README 与决策记录不再双写同一事实；安装双通道（npm / dsh-alpha）一目了然。
- 代价：机制性问询（分组如何派生、删除流程为何 git 先行、首启分组语义等）一律指向 `docs/decisions/`，读者多一跳；旧版迁移的具体命令不再在 IMPORTANT 块展开（`add` 命令已在块内，remove 旧名一句带过）。
- 边界：功能条目保留「用户可感知」层的行为描述（如失败原地重试、未提交文件红色计数），实现来源（命令、路由、投影机制）不保留。
