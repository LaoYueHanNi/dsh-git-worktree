# DR: 分支显式推送、首次发布确认与 IDEA 同步箭头

Status: implemented

## Problem

Issue #7 希望从分支菜单直接将工作树分支推送到远程。现有领先/落后箭头只包含数字：未配置 upstream、与 upstream 同步、upstream 已失效三态缺乏可区分信息，无法支持首次发布。用户要求采用 IDEA 的绿色右上、蓝色左下箭头，并在纯本地分支显示无数字的绿色箭头。

右键对象可能没有检出，也可能在另一个工作树检出；裸 `git push` 会依赖执行目录的 HEAD 与 push 配置，不能保证操作的是右键对象。从 `origin/main` 新建的 feature 分支还可能自动跟踪 main，直接推送 upstream 会把发布目标弄错。

## Decision

> [!NOTE]
> 本决策中的推送确认交互、无强制推送和标记选项的限制已于 2026-10-15 由 [DR: 紧凑推送审阅窗口](2026-10-15-compact-push-review-dialog.md) 取代。分支显式引用、默认目标及同步箭头继续生效。

> [!NOTE]
> 本决策中“网络 push 120 秒超时”“没有实时传输进度流，以‘正在推送’状态表达执行过程”两处已于 2026-10-16 由 [DR: 推送的悬浮进度](2026-10-16-push-floating-progress.md) 取代：`/push` 改为流式路由，传输期间有悬浮进度卡片与取消，约束改为 5 分钟无输出才终止（不带 `live` 的直接调用仍是 120 秒）。

本记录取代[原领先落后标记](2026-08-30-ahead-behind-marks.md)中单色直箭头、隐藏 gone 状态的选择，并扩展[行级右键菜单](2026-09-13-branch-row-context-menu.md)的动作范围。

- `/status` 在既有 `for-each-ref` 中以 `%09` 分隔 upstream 名称，保留 `BranchEntry.upstream` 和 `upstreamGone`；原有 ahead/behind 算法保持。普通本地行、工作树行、linked worktree 的自身分支与主检出行均透传。没有新增菜单展开时的 Git 进程或网络访问。
- `BranchMenu.renderArrows` 用同一 SVG 斜箭头表达入/出方向：领先为绿色 `↗ N`，落后为蓝色 `↙ N`，分叉同时显示；无 upstream 为绿色 `↗`、不带数字（仅当仓库存在远程时；纯本地仓库里每个分支都“未发布”，逐行标注只是噪音，故不显示）；已同步不显示；gone 显示黄色 `!` 与说明。11px 数字、等宽数字排版、名称优先的行尾布局、方向与 tooltip 辅助辨识继续保留。计数比较的是本地 remote-tracking refs，需 fetch 更新远端事实。
- 箭头尺寸不变，线条加粗（描边 2.2，提取图标沿用的 1.3 保持不变），在 12px 行内更易辨认；三种颜色优先取宿主状态令牌（success / link / warn），缺失时回退到 IDEA 色值。标记判定与动作可用性（`syncMark`、`syncActions`、`repoHasRemotes`）抽成纯函数以便测试，tooltip 数量区分单复数。“是否有远程”从已有分支列表推断（存在 remote-tracking 分支，或任一本地分支配置了 upstream），不新增 Git 进程；刚添加、尚未 fetch 且无人跟踪的远程在首次 fetch 或 push 前仍视为无远程，但右键“推送”不受影响。
- 本地与工作树行（包括工作树会话自己的当前分支）均有统一名为“推送”的入口，不区分发布/后续推送，远程行没有。该动作独立于创建/重命名的 `canCreate` 门槛；菜单位置在签出、新建、创建工作树等操作之后、重命名分支之前（工作树行紧跟“跳到此工作树”），“更新”紧挨在“推送”上方；右键菜单整体在执行期间禁用。当前分支且 upstream 有效时追加“更新”，工具栏更新动作也用此名称，继续调用原有 `fetch + merge --ff-only`；独立的 fetch 保留“提取”名称，不提供任意未检出分支的更新。
- 新增 `POST /push-plan` 和 `POST /push`。`src/push.ts` 从精确的 `refs/heads/<branch>` 解析跟踪事实，列举配置的 remote，优先 `branch.<name>.pushRemote`、`remote.pushDefault`、有效 upstream remote，然后 `origin`、首个 remote。配置指向不存在的 remote 时直接报错。默认目标始终是本地分支自己的完整名称。
- 推送入口现在打开独立审阅窗口；用户最终确认的紧凑布局、提交预览、标记范围与强制推送见上述后继记录。`/push-plan` 仍解析本地配置与默认同名目标；无显式目标的旧调用继续受 `plan.confirm` 约束。
- Push 针对显式源分支与完整目标引用，不切换 HEAD、不自动 commit/stash/rebase。普通推送保留 `--no-force --no-mirror --no-follow-tags --recurse-submodules=no`，并用本次进程的 `-c remote.<name>.mirror=false` 覆盖 mirror 配置；用户显式选取的标记和 force-with-lease 参数按后继记录追加。目标必须属于已配置 remote 且通过 Git ref-name 校验，不接受调用方任意 URL。
- 网络 push 使用执行器可选的 120 秒超时，其余 Git 命令仍是 20 秒。禁止终端凭据交互，沿用已配置的认证；保留 Git 错误及 porcelain 拒绝信息，超时提示核对远端后再重试。没有实时传输进度流，以“正在推送”状态和完成/错误反馈表达执行过程。
- 前端与 fetch/update 共用单飞锁。完成后刷新 `/status`，成功 toast 命名来源与目标；会话目录变化时丢弃旧目录的待处理预览，防止继续推送旧对象或回填旧事实。非平凡改动连同本记录交付。

## Alternatives considered

- **裸 `git push` 或用 HEAD 作为源** —— 会随执行目录、push.default 和远程 refspec 配置而变化，右键其它工作树分支时可能推错对象。显式分支与完整目标引用能固定行为。
- **仅在 ahead > 0 时开放推送** —— 新分支没有 upstream，恰好没有 ahead，无法覆盖 issue 的首次发布场景。
- **继承 origin/main 就直接推向 main** —— 自动跟踪来自建分支的默认行为，不足以表达用户要把 feature 发布到 main 的意图；异名跟踪要求确认，默认建议同名发布。
- **同名跟踪分支直接推送** —— 初版选择单远程确认、多远程选择即推送；后续用户通过本地 HTML demo 明确采用先审阅提交再推送的独立窗口，见后继记录。
- **没有任何远程时也给每个本地分支标“未发布”** —— 初版如此，但在纯本地仓库里每行都有绿箭头，信息量为零；无远程时不显示。以“分支列表里是否出现远程事实”判断，代价是新加未 fetch 的远程会晚一步出现标记。
- **单色箭头、忽略 gone** —— 原方案减少行内颜色，但用户明确要求 IDEA 方向配色；新增发布入口也给 gone 状态提供了修复出口。保留方向、数字和 tooltip，避免只凭颜色辨认。
- **实时进度通道** —— 当前命令执行器缓冲输出；新增 streaming/SSE 涉及额外生命周期协议，执行状态和结果已覆盖本次范围，暂不引入。

## Consequences

- 获得完整的发布与后续推送流程，普通分支和工作树有一致的同步标识；不需要先切换分支或切回终端，未提交文件保持原样。
- 成本是两条新路由、upstream 事实透传、发布表单和更长的网络操作等待。配置 remote 的 push URL 和服务端 hooks 仍按 Git 配置执行，插件不管理凭据或绕过分支保护。
- 普通非快进推送仍由 Git 拒绝；显式强制推送以预览的目标 OID 为 lease。历史浏览器联调验证了首次/后续推送、普通非快进拒绝与其他工作树分支推送，并修复请求字段白名单；测试仅使用临时本地 bare remote，没有向 GitHub/Gitee 推送。最终审阅窗口的验证与限制见后继记录。
