# dsh-git-worktree 插件需求与技术规格

状态: 已评审定稿（v1.0）· 交付形态: DSH 插件（独立包，`dsh plugin add` 安装）

## 1. 目标

在 Web UI 上为 git 仓库工作区提供分支可视化与 git worktree 隔离开发能力：

- 空白新会话阶段可见当前分支，可切换或勾选 worktree 隔离
- 勾选 worktree 后基于所选分支创建 worktree 目录，会话以新 worktree 为项目目录
- 同一 git 仓库的所有 worktree 在侧边栏归入该仓库的 workspace 分组
- worktree 存放根路径可在设置中自定义，默认 `~/.dsh/gitworktree`

## 2. 核心流程（状态机）

```
空白新会话（hero 阶段，blank session）
 │  composer 工具行渲染: [分支 chip ▾] [worktree 勾选 ◻]
 │
 ├─ 未勾 worktree + 改选分支
 │    → 确认弹窗（含多会话文件瞬变警告文案）
 │    → 确认后立即 git switch（原地切换，主仓库 workspace 不变）
 │
 ├─ 勾选 worktree + 改选分支（或勾选时已选非当前分支）
 │    → 确认弹窗（告知将创建的完整路径 + 目标分支; 已有 worktree 时改为"复用"文案）
 │    → 确认后执行:
 │       1. git worktree add <根>/<仓库名>/<规范化分支名>  (幂等: 已存在则复用)
 │       2. workspaces.create({ path: worktree目录 })  (幂等注册)
 │       3. startSession(worktreeWsId)  (复用/创建 blank session 并切换, 草稿迁移)
 │
 ├─ 发送第一条消息: 无特殊动作（session 已在目标目录, 消息直接发出）
 │
 └─ 非 git 目录: chip 与勾选不渲染
```

### UI 状态明细

分支 chip 对所有 git 会话可交互；worktree 勾选仅存在于 blank 会话（选定对话环境的那一刻）。
会话启动后目录即固定，只剩原地切分支（在 worktree 会话内 switch 只作用于该 worktree——
switch 路由以会话目录的 toplevel 为根，不动主 checkout）。

| 状态 | 分支 chip | worktree 勾选 |
|---|---|---|
| blank session（主仓库或 worktree） | 可交互, 列出本地分支 | 可勾选 |
| 已发消息的 session | 可切分支 | 不渲染（目录已固定） |
| 非 git 仓库目录 | 不渲染 | 不渲染 |

## 3. 架构（双端）

### host 半边（lib/index.js, cordis 插件）

- `execFile('git', …)` 执行: `rev-parse --git-common-dir`(探测仓库) / `branch -a` / `worktree list --porcelain` / `worktree add` / `switch`
- 自有 HTTP 路由 `/plugin/git-worktree/*`（`ctx.inject(['webServer'])`，答 `no-store`; 不走 `/api`）
  - `GET  /status?path=` → 仓库探测 + 当前分支 + 分支列表 + 已有 worktree 映射
  - `POST /worktree` `{ repoPath, branch }` → 幂等创建/复用 + 返回 worktree 路径
  - `POST /switch` `{ repoPath, branch }` → 原地 git switch
- `ctx.settings.register('git-worktree', schema)`: `rootDir`（默认 `~/.dsh/gitworktree`，绝对路径校验）
- 配置校验拒绝未知键; git 失败原样透出 stderr

### client 半边（lib/client.js, 工厂闭包）

- `ctx.slots.inject('conversation.input.left', …)`: 分支 chip + worktree 勾选组件
  - 数据 `fetch` 自有路由；非 git 目录不渲染
- `ctx.slots.inject('settings.section', …)`: 设置节（存放根路径输入框）
- i18n: `ctx.locale.register('git-worktree', { zh, en })`
- 切换 worktree: 复用框架 `workspaces.create` + `startSession`（blank 复用 + 草稿迁移由框架完成）

### 双端契约（src/wire.ts, 零依赖）

路由路径常量 + 请求/响应类型，host 路由与 client fetch 共享。

## 4. 关键规则

- **幂等**: 同分支 worktree 已存在 → 直接复用（git 保证一分支一 worktree）; workspaces.create 天然幂等
- **分支名规范化**: 目录名 = 分支名替换 `/`→`-`，去除 Windows 非法字符 `<>:"|?*` 与尾随点/空格
- **创建失败**: toast 显示 git 原始错误，UI 状态回退，不产生半成品 workspace 注册
- **git switch 失败**（脏工作区冲突等）: toast 错误，分支 chip 回显原分支
- **存放根路径**: 自定义时不写任何 exclude（worktree 不在项目内，无污染）
- **多仓库并存**: 路径规划 `<rootDir>/<仓库目录名>/<规范化分支名>/`，避免不同仓库同名分支冲突

## 5. 侧边栏（第一版决策）

worktree = 独立 workspace → 侧边栏平级组展示，组名自动命名 `<仓库目录名> · <分支名>`。
树形（父组 > worktree 子文件夹）留待后续版本（fork WorkspaceBrowser 或官方缝）。

## 6. 边界情况

| 情况 | 行为 |
|---|---|
| 仓库无任何远程 | 分支列表仅本地分支 |
| 分支在远程但未 pull | `worktree add -b <name> <remote>/<name>` 创建本地跟踪分支 |
| 目标分支已被其他 worktree 检出（git 硬约束） | 原地 switch 被 git 拒绝 → UI 预防性禁用该分支行；勾 worktree 时则正常复用 |
| 用户手动删除 worktree 目录（stale 注册） | status 过滤 stale 项；add/switch 前自动 `git worktree prune` 后重试一次 |
| git porcelain 路径分隔符 | git 输出统一 `normalize`（Windows 正斜杠 → 平台分隔符） |
| worktree 根不存在 | `worktree add` 前自动 mkdir -p |
| 非 git 目录的 workspace | `/status` 答非仓库, UI 不渲染 |

## 7. 里程碑

1. **M1 骨架+host git层** ✅ — 包结构/双构建/wire.ts/git 执行器+幂等+stale-prune/路由+41 项单测+真实 git 冒烟
2. **M2 chip UI** ✅ — composer 分支 chip + worktree 勾选 + 切换/创建流 + host 路由端到端验证
3. **M3 设置节** ✅ — settings.section UI + 自有 GET/PUT 路由持久化（宿主 settings wire 白名单不含第三方 ns，见 api-proxy.ts WEB_SETTINGS_NAMESPACES）
4. **M4 打磨** ✅ — 中英 README / 失败路径 / lib/ 产物随仓库提交

## 8. 包结构（遵循 dsh-plugin-dev 指南）

```
package.json          # main + exports ./client + dsh 字段 + cordis.patch.yml 引用
cordis.patch.yml      # 自动挂载
src/index.ts          # host: git 执行器/路由/settings 注册
src/client/index.ts   # client: chip/勾选/设置节/i18n
src/wire.ts           # 双端契约
src/git.ts            # git 命令纯封装（可注入 execFile 测试缝）
src/normalize.ts      # 分支名/路径规范化纯函数
tests/                # vitest
lib/                  # 预构建产物随仓库提交（无 prepare 脚本）
```
