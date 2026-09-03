# dsh-git-worktree

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

![Web 界面中的 dsh-git-worktree](gitworktree_zh.png)

简体中文 | [English](./README.md)

一个 [dsh] 插件：在 Web 界面进行简单的分支与 worktree 管理。输入框工具行显示当前分支 —— 选其他分支原地切换；勾选**「工作树」**则获得一个注册为真实工作区的隔离 worktree，效果见上图。

[dsh]: https://github.com/cordiverse/dsh

仓库：<https://github.com/LaoYueHanNi/dsh-git-worktree>

> [!IMPORTANT]
> **GitHub 直装已终止**——仓库不再携带构建产物，请改从 npm 安装：
>
> ```sh
> dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
> ```
>
> **从旧 `github:` 安装升级（≤ 0.3.2，包名 `dsh-git-worktree`）？** 原地 `update` 会加载失败——先移除旧包名，再重新安装。worktree 目录与插件设置完整保留。

## 功能

- **IDEA 风格分支选择器**：分支菜单把 `/` 视为文件夹层级——可折叠文件夹、末段标签，当前分支所在链路默认展开并居中。本地与远程分支分两个可折叠分组（单远程自动剥掉前缀），底部搜索保留匹配分支的祖先文件夹并高亮命中，左侧工具栏提供定位当前分支与全部展开/折叠，有上游的本地分支行尾显示 ↑N/↓N 领先落后标记。
- **远程分支检出**：远程组里选中 `origin/feat-x` 确认后原地检出并自动创建跟踪分支；勾选工作树开关则改为隔离进独立 worktree。
- **工作树快捷入口**：主仓库空白会话的分支菜单把被 worktree 占用的分支收进**「工作树」**分组（hover 显示目录路径），双击直接跳进对应目录开始新会话。
- **分支切换**：选分支、确认，原地 `git switch`。worktree 会话里入口整体收敛：其他分支照常展示但置灰，操作提示去主仓库发起；已启动的会话菜单只显示自己的分支（提取与更新仍可用）。
- **原地新建分支**：菜单工具栏的加号弹出创建弹窗，边输边校验（git ref 规则 + 重名检查）；「确认」一把完成新建并切换（detached HEAD 亦可用），失败后弹窗保留、可改名重试。
- **远程同步**：工具栏末位的刷新按钮 fetch 全部远程并清理失效跟踪分支——列表原地刷新，无需去终端。
- **更新当前分支**：把当前分支快进到其上游；本地分叉、无上游、工作区改动冲突都会被拒绝并给出 git 原话——插件绝不代你 stash 或改写历史。
- **工作树隔离**：空白会话勾选**「工作树」**弹出切出弹窗，分支名可编辑（预填第一个空闲的 `<当前分支>-wt`）；确认后切出并隔离到全新 worktree，注册为真实工作区。分支菜单仍可用——选其他分支则改为在 `~/.dsh/gitworktree/<仓库>-<分支>/` 下创建 worktree，重复选同一分支直接复用已有的。
- **删除工作树**：工作树行的 ⋯ 菜单提供**「删除工作树」**——弹窗先红色列出未提交文件数、标注领先提交数，并预告工作区下的会话将一并归档；确认后先删 worktree、再归档会话。git 失败时 DSH 侧零变更、弹窗原地重试。
- **未分组虚拟目录组**：不属于任何工作区的会话按目录聚成分组视图尾部的**「未分组」**区（虚线文件夹图标区分）。目录与已注册工作区匹配的组标注为失联会话；目录真实存在的组可一键注册为工作区；存放位直下消失的目录可一键重建空目录——历史会话自动归位。
- **存放根路径可配**：**设置 → 插件**下的 **Git 工作树** 卡片——目录选择器或手输路径，保存即生效；留空使用默认 `$DSH_HOME/gitworktree`。旧版 `~/.dsh/gitworktree/settings.json` 的值升级后自动迁入。
- **聚合工作区**：插件替换原生侧边栏，把同一仓库的主仓库与 worktree 聚成可折叠的仓库组——分组从磁盘 git 事实派生、不存关系数据。设置卡**聚合工作区**开关（测试功能，默认开）可随时切回原生列表。

  ![侧边栏按仓库聚合工作区](sidebar-grouping_zh.png)

## 安装

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
```

> 包声明了 `dsh.bundle`，`add` 会自动把插件挂进 profile 的层栈，无需手动改配置。需要 `web` profile（`dsh web`）。

运行 dsh **0.1.2 alpha** 宿主？请改装专用兼容版本：

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree@dsh-alpha
```

> `@dsh-alpha` 是 dist-tag，解析为最新的兼容构建（当前 `0.4.1-dsh-0.1.2-alpha.3`），peer 锁定 alpha 线——普通 `update` 不会把两条通道混装。宿主升回稳定线时，先移除此包，再按上面安装默认版本。

## 更新

```sh
dsh plugin --profile web update @laoyuehanni/dsh-git-worktree
```

## 移除

```sh
dsh plugin --profile web remove @laoyuehanni/dsh-git-worktree
```

`~/.dsh/gitworktree/` 下的 worktree 目录会保留；插件自身的设置存于 dsh 设置文档。

## 开发

构建一次、装符号链接、迭代：

```sh
npm install
npm run build && npm run build:client
npm test                # vitest
node scripts/smoke.mjs  # 基于构建产物的真实 git 冒烟
dsh plugin --profile web add link:D:/Code/dsh-worktree
```

重新构建并重启 `dsh web` 即可生效（插件目录里跑 `npx tsdown --watch` 可热重载客户端）。刻意不设 `prepare` 脚本——`lib/` 不入库，`npm publish` 现场构建打进 tarball。

临时只挂 host 半边（仅当次启动生效，不动 profile）：在仓库旁建 `cordis.yml` 指向构建出的 host 半边（Windows 需要 `file:///` 形式），随补丁启动：

```yml
- insert:
    - id: git-worktree
      name: 'file:///D:/Code/dsh-worktree/lib/index.js'
```

```sh
dsh web --patch <插件目录>/cordis.yml
```

此模式只挂载 host 半边（`/plugin/git-worktree/*` 三条路由照常工作）；开发 UI 请用上面的 `link:` 安装方式。
