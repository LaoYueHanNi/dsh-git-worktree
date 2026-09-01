# dsh-git-worktree

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

![Web 界面中的 dsh-git-worktree](gitworktree_zh.png)

简体中文 | [English](./README.md)

一个 [dsh] 插件：在 Web 界面进行简单的分支与 worktree 管理。输入框工具行显示当前分支 —— 选其他分支原地切换；勾选**「工作树」**则获得一个注册为真实工作区的隔离 worktree，效果见上图。

[dsh]: https://github.com/cordiverse/dsh

仓库：<https://github.com/LaoYueHanNi/dsh-git-worktree>

> [!IMPORTANT]
> **从 0.3.2 及更早的 GitHub 直装升级？** 0.4.0 起插件发布到 npm，包名变更为 `@laoyuehanni/dsh-git-worktree`（原裸名在 npm 上已被第三方占用）。旧的 `github:` 安装**无法通过 `update` 升级**——包名已变，原地 update 会导致插件加载失败。从 0.4.0 开始使用，需先移除旧包名，再重新安装：
>
> ```sh
> dsh plugin --profile web remove dsh-git-worktree
> dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
> ```
>
> 迁移不影响数据：`~/.dsh/gitworktree/` 下的 worktree 目录与插件设置完整保留。

## 功能

- **IDEA 风格分支选择器**：分支菜单把 `/` 视为文件夹层级 —— 可折叠文件夹、末段标签，当前分支所在链路默认展开并居中。列表分**本地分支**与**远程分支**两个可折叠分组；远程组在单远程仓库下自动剥掉 `<远程>/` 前缀，多远程则保留全名（`origin`/`upstream` 成为组内文件夹）。单击选中（蓝底），双击或 Enter 弹出右侧确认弹层。左侧工具栏提供**定位当前分支**与**全部展开/折叠**；底部搜索保留匹配分支的祖先文件夹并高亮命中字符；超长标签悬停显示全名。有上游的本地分支行尾显示 **↑N/↓N 领先落后标记**（悬停看完整含义）。
- **远程分支检出**：远程组里选中 `origin/feat-x`，确认后原地检出并自动创建跟踪本地分支 `feat-x`（git dwim）；勾选工作树模式则从远程分支新建孪生分支并隔离进独立 worktree。
- **工作树快捷入口**：主仓库空白会话的分支菜单把被 worktree 占用的分支收进「工作树」分组（hover 显示目录路径），**双击直接跳进对应目录**开始新会话——零 git 动作、无确认弹层；已开始的会话不显示该分组。
- **分支切换**：从 chip 菜单选分支、确认后原地 `git switch`。**worktree 会话的入口整体收敛**：未启动时其他分支照常展示但置灰，任何分支操作（含工作树跳转、新建分支）都会提示「分支操作请在主仓库发起」，工作树开关也不渲染——发起 worktree / 新分支是主仓库的决策；已启动时菜单仅展示该会话自己的分支（提取、更新当前分支仍可用，两者不动检出）。
- **原地新建分支**：分支菜单左侧工具栏的加号在卡片右侧弹出创建弹窗——弹窗内输入名称（边输边校验 git ref-name 规则 + 重名检查，非法或重名时输入框下方标红提示），点「确认」一把完成新建并原地切换（`git switch -c`），detached HEAD 亦可用；失败 toast 后弹窗保留、可改名重试——即不带工作树的「切出」孪生流程。
- **远程同步**：分支菜单工具栏末位的刷新按钮执行 `git fetch --all --prune`——远程新增/删除的分支当场出现在列表里，无需去终端；菜单保持打开并原地刷新，失败 toast。
- **更新当前分支**：实线箭头（虚线提取旁）更新**当前分支**——先 fetch 全部远程，再把当前分支快进（`--ff-only`）到其上游。本地分叉、无上游、工作区改动冲突都会被拒绝并给出 git 原话；插件绝不代你 stash 或改写历史。
- **工作树隔离**：空白会话上勾选**「工作树」**立即在 chip 上方弹出「从当前分支切出」确认弹窗——弹窗内可**编辑新分支名**（预填第一个空闲的 `<当前分支>-wt`，重名自动递增 `-wt2`、`-wt3`…），确认后从当前检出切出**新分支**并隔离到全新 worktree；分支 chip 的菜单仍可打开，选其他分支则在 `~/.dsh/gitworktree/<仓库>-<分支>/` 下执行 `git worktree add`。两条路径都会注册为真实工作区并跳转到新目录的空白会话。重复选同一分支直接复用；失效注册自动 prune 恢复。取消确认弹窗后直接发消息，即默许在当前目录开始会话。
- **删除工作树**：聚合侧边栏里工作树行的 ⋯ 菜单新增**「删除工作树」**——一条确认流收尾整个生命周期：弹窗先检查目标目录（`POST /inspect`），红色列出**未提交文件数**（会随目录一并删除）、中性标注**领先上游的提交数**（分支保留在 git 里，提交不丢），并预告该工作区下的会话将**一并归档**（不会倾倒进「未分组」，取消归档可找回）。确认后先 `git worktree remove`（有未提交文件自动 `--force`；stale 注册直接 prune），成功后再归档会话、删除工作区注册——git 最易失败（Windows 文件占用），放在最前则失败时 DSH 侧零变更、弹窗原地重试。有进行中或正在浏览的会话时不显示该菜单项（先归档或切走再删）；主仓库行不可删。
- **未分组虚拟目录组**：分组视图尾部新增**「未分组」区**——不属于任何工作区的会话（删过注册又重建的残留、首启后才出现的历史）按会话头 cwd 聚成**虚拟目录组**（大小写不敏感，目录改名前的旧路径照聚），hover 显示完整路径。目录与某个已注册工作区匹配的组标注**「属于「X」的失联会话」**；未匹配的组可一键**「注册为工作区」**（此后新会话自动归位；旧失联会话仍留在未分组直至收复功能落地），注册失败（如目录已不存在）Toast 透出原因。
- **存放根路径可配**：**设置 → 插件**页签下的 **Git 工作树** 卡片 —— 原生目录选择器或手输绝对路径，保存即生效（新建的 worktree 落在新目录，已有的留在原地，git 仍能识别复用）。留空使用默认 `$DSH_HOME/gitworktree`（`~/.dsh/gitworktree`）。设置存于 dsh 统一设置文档；旧版 `~/.dsh/git-work-tree/settings.json` 的已保存值会在升级后自动迁入（原文件改名 `.migrated` 保留）。
- **聚合工作区**：DSH 尚未开放多工作区聚合接口，故按原生侧边栏 1:1 替换左侧列表，并把同一仓库的主仓库与 worktree 工作区聚成可折叠的**仓库组**——主行显示 `主仓库（分支）`，工作树行显示分支。分组从磁盘 git 事实派生、不存关系数据；没有 worktree 的仓库保持单行。设置卡 **聚合工作区**（测试功能，默认开）可随时切回原生。

  ![侧边栏按仓库聚合工作区](sidebar-grouping_zh.png)

## 安装

### 从 npm 安装

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
```

> 包声明了 `dsh.bundle`，`add` 会自动把插件挂进 profile 的层栈，无需手动改配置。编译产物 `lib/` 随 npm 包分发，安装开箱即用，无需任何构建步骤。需要 `web` profile（`dsh web`）。

### 从本地目录安装（开发调试用）

```sh
dsh plugin --profile web add link:D:/Code/dsh-worktree
```

`link:` 安装的是符号链接：重新构建插件后重启 `dsh web` 即可生效。

## 更新

```sh
dsh plugin --profile web update @laoyuehanni/dsh-git-worktree
```

## 移除

```sh
dsh plugin --profile web remove @laoyuehanni/dsh-git-worktree
```

插件会从 profile 移除并停止加载。`~/.dsh/gitworktree/` 下的 worktree 目录会保留；已迁移的旧设置文件（`settings.json.migrated`）如不需要可手动删除，插件自身的设置项存于 dsh 设置文档。

## 开发

先构建一次插件：

```sh
npm install
npm run build && npm run build:client
npm test                # vitest（60 项测试）
node scripts/smoke.mjs  # 基于构建产物的真实 git 冒烟
```

> **刻意不设 `prepare` 脚本。** 编译产物 `lib/` 已提交进仓库，并随 npm 包分发。pnpm ≥ 10 默认拒绝执行依赖的构建脚本，除非加入白名单，因此若保留 `prepare`，pnpm 用户的安装会出现被跳过或失败的步骤。改为分发预构建产物后，`dsh plugin add @laoyuehanni/dsh-git-worktree` 才能开箱即用。**改动 `src/` 下的任何文件后，务必重新构建并提交更新后的 `lib/`**（并发布新版本），否则别人安装到的是旧产物：

```sh
npm run build && npm run build:client
git add lib/
```

临时挂载 —— 仅当次启动生效，不动 profile。在仓库旁建一个 `cordis.yml` 指向构建出的 host 半边（Windows 需要 `file:///` 形式）：

```yml
- insert:
    - id: git-worktree
      name: 'file:///D:/Code/dsh-worktree/lib/index.js'
```

```sh
dsh web --patch <插件目录>/cordis.yml
```

此模式只挂载 host 半边（`/plugin/git-worktree/*` 三条路由照常工作）；分支 chip 依赖按包名解析的客户端 bundle，因此开发 UI 请用上面的 `link:` 安装方式：执行 `npm run build && npm run build:client`（或在插件目录跑 `npx tsdown --watch`）并重启 `dsh web` 后，浏览器端插件会自动热重载。
