# DR: 侧边栏工作树行可删除——脏文件知情强删、会话先归档、git 先行

Status: implemented

## Problem

插件能创建/复用 worktree（三条路径），能把会话跳进 worktree，却没有任何删除出口：`git worktree remove` 不存在，`~/.dsh/gitworktree/` 下的目录只增不减，清理只能去终端。而清理其实横跨三层——git 注册、磁盘目录、DSH workspace 注册——DSH 原生的「删除工作区」只删注册（不动 git、不动目录），删完还会把该工作区名下的会话倾倒进「未分组」；手动删目录则留下 stale 注册，只能等下次 add/switch 被动 prune。生命周期"进入做得极顺（双击直达）、退出完全没做"。

## Decision

在分组侧边栏的**工作树行菜单**加入「删除工作树」，一条确认流走完三层清理：

- **入口纪律**：仅 `label.type === 'linked'` 的行渲染该菜单项，且仅当侧边栏判定该行空闲——`containsCurrent || 有 running 会话` 时整项不出现（归档或切走即恢复）。与"分支操作请在主仓库发起"同哲学：想删 A，先离开 A。主 worktree 行天然不渲染（它是 `main` 不是 `linked`）。
- **知情强删**：确认弹窗打开时 `POST /inspect`（`status --porcelain` 行数 = 脏文件数、`rev-list --count @{u}..HEAD` = ahead 数）——脏文件数红色展示（这些会随目录丢失），ahead 数中性展示（分支 ref 在 `worktree remove` 后保留，提交不丢），并预告"该工作区下的 N 个会话将一并归档"。确认时 `dirty > 0` 自动携带 `--force`；inspector 未就绪则确认键禁用。
- **执行顺序 git 先行**：`POST /remove`（live 目录 `worktree remove`；stale 注册直接 `prune`，幂等且顺带覆盖"手动删目录"的收尾场景）成功后才做 DSH 侧——逐个归档非归档会话，最后删 workspace 注册。git 是最易失败的一步（Windows 文件占用），放在最前则失败时 DSH 侧零变更、弹窗原地重试；DSH API 失败留下的坏状态（目录没了注册还在）恰是既有 stale-prune 可自愈的形状。
- **会话归档而非倾倒**：不归档的会话在 workspace 注册删除后会显示在「未分组」；归档后的会话在所有分组视图（含未分组）隐藏、日志保留、可取消归档找回。归档集合 = `sessionIds` 减去已归档、blank、subagent（blank 无内容且非当前时本就不可见；subagent 行不是用户在此管理的对象）。单个归档失败只 `console.warn` 不中断——删除是主目标，残留可见性是小害。
- **协议**：`POST /inspect`（`{ path }` → `{ dirty, ahead? }`）与 `POST /remove`（`{ path, force? }` → `{ path, pruned }`）两条新路由；host 层 `inspectWorktree`/`removeWorktree` 走既有 `Exec` 缝，主 worktree 与未注册路径以合成 `GitError` 拒绝并映射 400。

## Alternatives considered

- **脏工作区硬阻止（git 原生行为）**——实验性分支恰恰以脏收场，硬阻止把用户逼回终端 stash，绕开了插件本身。否。
- **照抄 DSH 原生删除语义（会话落未分组）**——「未分组」会随每次删除膨胀，且归档机制本就是 DSH 为"收起但保留"准备的工具。否。
- **先删 workspace 注册再 git remove**——git 失败（文件占用）时留下"注册没了、目录还在"的半态，且该方向无自愈机制；倒序后半态变成 stale 注册（可 prune 自愈）。否。
- **running 会话一并归档强删**——归档只是视图隐藏，任务还在跑：目录消失让任务中途失败，且失败被归档遮蔽不可见。禁用入口（等结束或手动归档）给了明确出路。否。
- **双入口（再加主仓库分支菜单「工作树」分组行）**——该分组仅 blank 会话可见，行内已有双击跳入语义，交互密度过高；分组侧边栏（默认开）的行菜单覆盖绝大多数场景。留待有真实诉求再加。否。
- **删除时级联删分支（`branch -d/-D`）**——收尾更彻底但多一档不可逆决策，与"分支是用户资产"的边界冲突；分支保留在 git 里管理成本为零。否。

## Consequences

- 代价：删除是破坏性操作，确认弹窗承担了全部安全责任（脏计数、ahead 预告、归档预告缺一不可）；「删除工作树」与「删除工作区」两个菜单项并存，文案必须区分清楚；切回原生侧边栏（实验开关关闭）的用户暂无删除入口；`-wt` 派生分支仍留在 git 里（不级联删）。
- 换来：worktree 生命周期首次闭环——创建、进入、退出都有 UI 出口，目录不再只增不减；删除失败可干净重试（git 先行 + stale 自愈兜底）；侧边栏零残留（归档而非倾倒未分组）；三层状态（git/磁盘/DSH 注册）在一条流里收敛一致。
