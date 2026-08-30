# DR: 从当前分支原地新建分支（不带工作树）

Status: implemented

## Problem

插件的分支动作版图缺一格：switch 切的是已有分支，worktree 为已有分支建工作树，cutout（0.4.0）虽从当前分支切出新分支但强制绑定工作树隔离 + 跳转会话。用户想要"从当前分支新建分支、留在当前目录干活"时只能去终端敲 `git switch -c`，chip 上的分支状态还要靠窗口聚焦时的拉取才追上来。

## Decision

新增第四条动作路径"原地新建分支"（`git switch -c`），与 cutout 构成有无工作树的一对：

- **服务端**：`wire.ts` 新增 `POST /plugin/git-worktree/branch`（`{ repoPath, name }` → `{ branch }`）；`git.ts` 新增 `createBranch`（`git switch -c <name>`），在 probeRepo 探出的会话目录自身 toplevel 执行——与 switch 同款语义，linked worktree 里原地建并在该 worktree 内检出，不碰主检出；detached HEAD（currentBranch 为 `HEAD`）天然支持。路由骨架照抄 handleSwitch，`gitFailure` 的 usage 识别补上 `not a valid branch name` → 400。
- **交互**：入口是 BranchMenu 左侧工具条第三个图标（加号，与 locate/expand-all 同列，IDEA 姿势），worktree 模式下禁用——cutout 已覆盖"新分支"那条路，双入口并存只会混淆。点开后在卡片右侧弹出**创建弹窗**（确认弹层的 submenu 姿势），命名输入、实时校验、取消/确认同在一个面板里一把完成：`normalize.ts` 的 `branchNameIssue` 纯函数预检 git ref-name 规则（`git check-ref-format` 拒绝集的键入子集）+ 与 rows 查重，非法或重名时输入框下方标红提示（切点由弹窗标题"从 {branch} 新建分支"承载，不再常驻提示行）；点「确认」（或输入框回车）直接执行，**无第二段确认**——在弹窗里敲下名字本身就是意图表达。`git switch` 仍是最终权威，漏网名字走错误 toast，弹窗保留可改名重试；执行期间 busy 冻结弹窗（初版曾做成卡片内命名行 + 二段确认弹层的两段式，实测交互割裂，同日合并为弹窗一把式——见 Alternatives）。
- **建完即切**：创建动作一步完成"建 + 切换"，成功后 refresh 刷新 chip。不做"只建不切"。
- **确认弹层的生命周期**：`create` 与 `switch` 同类，是已开始会话的原地特性，session 从 blank 转换时保留。

## Alternatives considered

- **复用底部搜索框**（VS Code 式：搜不到时首行渲染"创建 `query`"）——零新增 chrome，但"搜不到 ≠ 想新建"语义混载，搜索框在卡片底部、与向上生长的列表方向相反，Enter 还要和现有 commitFirst 纠缠。放弃，可作为后续增强。
- **建完不切（纯 `git branch`）**——与 chip"为会话选环境"的产品语义相悖，用户建完还得再点一次切换；v1 不做，若真有需求走终端。
- **命名免确认，回车直接建**（IDEA/VS Code 行为）——曾在两段式初版里以"插件惯例是所有变更动作必过确认"为由放弃；实际使用后修订为折中形态：弹窗内输入 + 确认按钮一把执行，无第二段弹层。理由：两段式把"输入"（卡片内）和"确认"（另一弹层）拆在两处，交互割裂；而弹窗内敲名字已是明确的意图表达，再确认一次纯属多余。惯例让位于输入形态——带二次确认的弹层保留给"点选已有分支"类零输入动作（switch/worktree/cutout）。
- **弹窗内输入框放卡片内（初版形态，已推翻）**——命名行嵌在分支卡片 heading 下方，回车再弹确认。问题：输入与确认两段割裂、卡片内多出一个状态层（Escape 多一退栈层）、输入行挤占列表空间。推翻为右侧创建弹窗，输入/校验/确认同面板。
- **服务端跑 `git check-ref-format` 预检**——多一次 git 往返，而 `git switch -c` 本身就会拒绝并给出 stderr；`gitFailure` 识别该 stderr 为 400 即可，客户端 `branchNameIssue` 已提前挡住绝大多数。放弃。
- **入口放独立"+"直接弹输入弹层（不进菜单）**——少一步，但新建分支天然发生在"挑分支"语境里，脱离菜单失去"建完看到它出现在列表里"的即时反馈。放弃。

## Consequences

- 代价：BranchMenu 多一个状态层（creating/draft）与一层 Escape 退栈（confirm → 命名表单 → 搜索词 → 选中 → 菜单），文档键入路径上的 document keydown 输入框判断从 `querySelector('input')` 放宽为全量 input 匹配；`gitFailure` 的 usage 串匹配多一条。
- 换来：动作版图补全（switch / worktree / cutout / create 四格），从当前分支开新线的完整闭环不出 Web UI；确认、toast、单飞 busy 全部复用既有机制，无新弹层组件。
- 边界：`createBranch` 用查询目录的 toplevel 而非主检出执行，linked worktree 会话里建的新分支落在该 worktree——与 switch 行为一致，用户预期统一；主检出占用对新分支名无约束（新名字不可能被别的 worktree 占用），无需 cutout 那套 `-wt` 后缀巡检。
