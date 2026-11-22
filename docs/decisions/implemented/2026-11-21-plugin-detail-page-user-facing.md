# DR: 插件详情页补双语用户向正文

Status: implemented

## Problem

插件页此前只有 `locale/zh.json` 一句中文描述（"支持分支操作与工作树功能的dsh插件"），`locale/en.json` 的 `meta` 为空——英文界面落到 `package.json` 的 `description` 兜底；详情页没有自己的正文，只能回退渲染整份 README。README 的功能清单有十七条、按特性罗列且面向维护者，用户在详情页第一屏看不到「入口在哪、我能怎么用」；一句话 description 也装不下右键动作、工作树勾选与删除边界这些用法。

## Decision

在[包级 locale 词典](./2026-09-28-plugin-locale-display-metadata.md)之上，`locale/en.json` 与 `locale/zh.json` 各自声明完整的 `meta.title`、`meta.description` 与 `meta.detail`：

1. `meta.description` 一句话说明能力并点出 UI 入口（输入框工具行的分支菜单、勾选「工作树」）。
2. `meta.detail` 指向 `docs/DETAIL.md`（英文）与 `docs/DETAIL.zh.md`（中文）。正文是用户向说明，按「你能做什么 / 一些边界」组织：看分支切分支、右键动作与推送、提交图谱、工作树勾选与隔离、远程同步，以及目录固定、删除工作树的后果、不代改历史这些边界。事实全部从 README 浓缩，不新增权威来源。
3. `package.json` 的 `files` 收录两份 DETAIL 文档；发布产物按声明逐文件收录，不连带 `docs/` 其余内容。文档分工固定为：DETAIL = 插件页正文（用户向），README = 安装与技术说明，`docs/decisions/` = 设计取舍。

## Alternatives considered

- **把 README 功能清单整篇当详情正文** —— 输在长度与视角：十七条维护者清单，用户第一屏抓不到入口与用法。
- **只改两句 description、不设 detail** —— 输在展示空间：工作树勾选、右键六动作、删除即归档这些语义装不下，英文用户仍无正文可读。
- **detail 按官方模板做成单张功能图** —— 官方模板约定 detail 文档恰好一行图；本插件截图是整页 UI，640×300 画布放不下分支菜单的要点，无字示意图又表达不了操作语义。宿主本就渲染任意 Markdown 文档，文字正文可搜索、可随界面语言切换，故保留文字版（与 dsh-session-tools 的实践一致）。
- **英文 locale 省略 detail、回退英文 README** —— 等于不给英文用户正文；既然补了英文 description，正文一并翻译，成本可控。

## Consequences

- 代价：DETAIL 与 README 两处需随功能同步维护（README 为权威，DETAIL 是浓缩投影）；新增英文正文翻译面；发布产物多两个文件。
- 换来：插件页中英文都有标题、一句话描述与第一屏可读的用法说明；入口（输入框工具行的分支按钮）首次写进用户视野；README 保持技术文档定位，不再被整篇塞进详情页。
