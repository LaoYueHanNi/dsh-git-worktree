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
- **远程分支检出**：远程组里选中 `origin/feat-x` 直接原地检出并自动创建跟踪分支（免确认）；勾选工作树开关则改为隔离进独立 worktree。
- **行级右键菜单**：分支行右键弹出六个动作——签出（免确认直接切）、新建、新建并检出、重命名分支（本地行）、删除分支（本地行，安全 `-d`，git 拒绝未合并提交与被占用分支）、复制分支；工作树行为跳到此工作树 + 复制路径 + 删除工作树。二级弹窗（命名/确认）直接在菜单位置就地展开，原地动作完成后菜单保持打开，可连续操作。键盘走方向键 + Enter。
- **工作树快捷入口**：主仓库空白会话的分支菜单把被 worktree 占用的分支收进**「工作树」**分组（hover 显示目录路径），右键「跳到此工作树」直接跳进对应目录开始新会话。
- **分支切换**：选分支即原地 `git switch`（免确认）。worktree 会话里入口整体收敛：其他分支照常展示但置灰，操作提示去主仓库发起；已启动的会话菜单只显示自己的分支（提取与更新仍可用）。
- **从任意分支新建/重命名**：右键任意分支行即可**从该分支**新建（不动当前检出）或新建并检出（当场签出），创建弹窗边输边校验（git ref 规则 + 重名检查）、一把执行，失败后弹窗保留、可改名重试；本地行还可原地重命名。
- **远程同步**：工具栏末位的刷新按钮 fetch 全部远程并清理失效跟踪分支——列表原地刷新，无需去终端。
- **更新当前分支**：把当前分支快进到其上游；本地分叉、无上游、工作区改动冲突都会被拒绝并给出 git 原话——插件绝不代你 stash 或改写历史。
- **工作树隔离**：未开始的会话里，右键任意分支行即可**「创建工作树」**（复用或新建目录）或**「新建分支并创建工作树」**（从该分支切出新分支，名字手动输入），确认后隔离到仓库内的 `<repo>/.dsh/gitworktree/<分支>/`（通过 `.git/info/exclude` 本地忽略——源仓库 `git status` 保持干净）并注册为真实工作区，重复创建复用已有（无论它位于何处）；会话开始后目录固定，工作树选项随「工作树」分组一并隐藏。
- **删除工作树**：分支菜单**「工作树」**分组的行右键（及管理弹窗）提供**「删除工作树」**——弹窗先红色列出未提交文件数、标注领先提交数，并预告工作区下的会话将一并归档；确认后先删 git worktree（分支本身保留），再归档会话、注销工作区。git 失败时 DSH 侧零变更、弹窗原地重试；有正在运行的会话时该项禁用。
- **工作树管理**：**设置 → 插件**里的插件配置页可打开管理弹窗，跨仓库列出两处存放位置（各仓库的 `.dsh/gitworktree` 布局与旧的集中根目录）的全部工作树，按仓库分组并带来源标识，无法识别的目录也在列。
- **历史位置只读**：同一页面只读展示历史集中存放根（默认 `~/.dsh/gitworktree`）——已有工作树原地保留、照常可用，新建的落在各仓库内。旧版 `~/.dsh/gitworktree/settings.json` 的值升级后自动迁入。

> [!NOTE]
> - 原生侧边栏不受影响：工作树是普通注册工作区，工作区树会把各仓库内的布局自动归到其仓库之下（集中存放的旧工作树位置不变，只有新建的才归位）。
> - `git clean -xdff`（双 `-f`）会删掉仓库内的工作树目录（单 `-f` 会跳过嵌套仓库）；删后 `git worktree prune` 可恢复注册，但其中未提交的改动会丢。
> - 某仓库的工作区全部注销后，它的工作树不再出现在管理弹窗与自动清理中；重新注册该仓库任一目录即可找回。

## 安装

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree
```

> 包声明了 `dsh.bundle`，`add` 会自动把插件挂进 profile 的层栈，无需手动改配置。需要 `web` profile（`dsh web`）以及 dsh **0.1.6-alpha.2**（或更新）宿主。

运行 dsh **0.1.2 alpha** 宿主？请改装专用兼容版本：

```sh
dsh plugin --profile web add @laoyuehanni/dsh-git-worktree@dsh-alpha
```

> `@dsh-alpha` 是 dist-tag，解析为最新的 alpha 宿主兼容构建（当前 `0.4.3-dsh-0.1.2-alpha.5`），peer 锁定 alpha 线——普通 `update` 不会把两条通道混装。已在 0.1.2-rc.1 或更新宿主上，请用上面的默认线。

## 更新

```sh
dsh plugin --profile web update @laoyuehanni/dsh-git-worktree
```

## 移除

```sh
dsh plugin --profile web remove @laoyuehanni/dsh-git-worktree
```

两处位置（各仓库的 `.dsh/gitworktree` 布局与旧的集中根目录）的 worktree 目录都会保留；插件自身的设置存于 dsh 设置文档。

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
