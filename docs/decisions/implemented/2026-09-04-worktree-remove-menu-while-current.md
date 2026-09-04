# DR: 删除工作树菜单在当前会话与单行 linked 上仍展示

Status: implemented

## Problem

新建 linked 工作树后，插件立刻 `startSession` 出一个空白会话并选中它。侧边栏把 `containsCurrent` 当成占用，整项不渲染「删除工作树」，用户第一时间只能看到「删除工作区」（只删 DSH 注册，不动 git/目录）。同时，新 path 改变 facts 签名会丢掉整批 `/group` 缓存，树暂时全部降成 plain；即便探测回来，若该仓库此刻只有这一棵注册工作树，单成员降级也会把 `linked` 标签擦成 `plain`，菜单仍然没有。

这是对 [侧边栏工作树行可删除](./2026-09-01-worktree-remove-lifecycle.md) 入口纪律的细化：隐藏条件把创建后立刻删除这条真实路径堵死了。

## Decision

1. **菜单**：`label.type === 'linked'` 且没有 `running` 会话即展示。当前会话（含空白「新会话」）不再隐藏该项；确认弹窗仍预告将归档的会话。running 仍隐藏——删掉正在跑的任务的 cwd 才是要挡住的洞。
2. **单行 linked**：facts 标明 `main: false` 的成员即使视觉降级为 `kind: 'single'`（无仓库组头）也保留 `label.type === 'linked'`。主 worktree 单行仍是 `plain`。
3. **facts 签名超集**：新 workspace 拓宽路径签名时，复用 live/cache 里仍存在的 path 的 facts；未知新 path 保持缺省（plain），等 `/group` 落地后再并入。

## Alternatives considered

- **维持 containsCurrent 隐藏，靠文案教用户先切走** —— 创建流必然选中新工作树，等于要求用户做一步插件自己造成的手续。否。
- **占用时展示但禁用，tooltip「请先切换会话」** —— 比完全消失好，仍多一次跳转才能删刚建的测试工作树。否：确认弹窗已承担知情。
- **facts 未到时对所有行都给删除工作树** —— 主 checkout 也会出现该项，host 再拒绝。否：只在 git 事实证明是 linked 时给。

## Consequences

- 代价：当前会话在目标工作树里时也可以点删除；确认后目录消失、该会话被归档，需要宿主把选中切走。running 仍挡住。
- 换来：新建工作树后第一时间就能看到「删除工作树」；加一棵树时侧栏不会整树打回平铺。
