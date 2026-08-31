# DR: 声明插件市场截图清单（screenshots.json）

Status: implemented

## Problem

dsh-market 详情页按仓库根 `screenshots.json` 展示截图（awesome-dsh-plugin contributing.md 的约定），未声明时回退为从 README 自动抽取图片，顺序与选取不可控。本仓库 README 顶部刚加入 awesome 收录徽章（badge.svg 是 markdown 图片），自动抽取的首图会变成徽章而不是插件界面截图；同类插件 dsh-token-usage 已实测踩过同一问题并用清单解决。

## Decision

仓库根新增 `screenshots.json`（数组形式，路径相对仓库根），按卖点主次声明界面截图。截图按界面语言拆成两套：`gitworktree.png` / `sidebar-grouping.png` 给英文 README，`gitworktree_zh.png` / `sidebar-grouping_zh.png` 给中文 README。清单四张都列上，市场详情按此顺序展示。更新截图只需推送本仓库，市场下一次构建自动生效，无需向 awesome-dsh-plugin 提 PR。

## Alternatives considered

- **不声明，靠 README 自动抽取** —— 加入徽章后首图会变成 badge.svg，抽取结果确定性地错误；这正是 dsh-token-usage 记录过的问题。
- **先补拍多张界面截图再声明** —— 当时截图资产只有一张，清单可以随后续截图补充逐步扩展，不该反过来阻塞声明。
- **把截图挪进 docs/images/ 统一路径** —— 中英文 README 都引用仓库根现名，挪动徒增链接维护，清单直接用现有路径。

## Consequences

- 代价：`screenshots.json` 与图片文件名耦合，截图改名或删除须同步维护该清单。
- 换来：市场详情页的截图选取完全可控（首图必是界面效果图而非徽章），不再依赖 README 抽取的回退行为。
