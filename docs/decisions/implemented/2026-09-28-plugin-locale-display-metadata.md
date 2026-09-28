# DR: 插件显示元数据走宿主 locale 词典（包级本地化）

Status: implemented

## Problem

宿主 `dsh-app-boot` 会为每个插件包读取一份「本地化显示元数据」：插件管理列表中的标题与描述不再直接取 `package.json` 的 `name` / `description`，而是经由 `dsh-client-locale` 的 `resolveText()` 按当前界面语言取值。取值链路上有两个此前没有覆盖到的位置：

1. **列表卡片显示英文包名**：`@laoyuehanni/dsh-git-worktree` 未提供词典，`pkg.meta` 为 `undefined`，`packageText()` 回退到 `pkg.name`，于是卡片标题显示为 `@laoyuehanni/dsh-git-worktree`、描述显示为英文 `description`。同一列表中已本地化的插件显示中文，两类插件风格割裂。
2. **直接改写 `package.json` 的 `name` / `description` 不可行**：`name` 决定 npm 包名与宿主加载时的 specifier，改中文会让包名非法或改变依赖标识；`description` 是单一字符串，无法承载按语言切换的多份文案。

## Decision

在包根目录引入 `locale/<语言>.json` 作为插件级显示词典，并向 `package.json` 放行该目录：

1. **`locale/zh.json`** 承载中文 `meta.title` 与 `meta.description`，两者均为非空字符串（宿主 `textOf()` 会拒绝空串并抛错）。
2. **`locale/en.json` 作为目录锚点，内容为 `{ "meta": {} }`**。这是必需文件而非占位符：宿主 `readPluginMeta()` 先解析 `locale/en.json`，再以其所在目录做 `readdirSync` 扫描整份词典集。en.json 缺失时词典集为空 Map，**同目录下的 zh.json 一并被忽略**，且此路径不抛错、不告警。
3. **`exports` 放行 `"./locale/*.json": "./locale/*.json"`**。宿主经 Cordis `ModuleLoader.resolveSync()` 解析子路径，严格遵守 `exports` 白名单；缺少该条目时 `optionalResourcePath()` 返回 `undefined`，同样静默失效。
4. **`files` 收录 `locale`**，保证 `npm pack` 不漏掉该目录。
5. **英文侧行为不变**：宿主 `localizedText()` 以 `manifest.name` / `manifest.description` 作为 `en` 键的兜底，en.json 的 `meta` 留空即表示沿用原值，界面语言切到英文时行为与改动前完全相同。

文件名采用 `zh` 而非 `zh-CN`：宿主按「精确 id → 主语言 subtag → en」的 fallbackChain 取值，`zh` 在两种注册形式下均能命中；与 `dshmarket` 的既有写法保持一致。

## Alternatives considered

- **把中文文案合并进 `package.json` 的 `description`（形如「英文 · 中文」双语拼接）**：单字符串无法按语言切换，界面语言为英文时仍会显示中文尾巴；且 `name` 无对应的双语结构，标题问题无法解决。
- **在客户端 `src/client/locales.ts` 现有字典里补卡片文案**：该字典经 `dsh-client-locale` 的命名空间机制驱动插件自身 UI，与宿主读取的包级 `meta` 是两套独立机制，管不到插件管理列表卡片。
- **直接 patch 宿主 `packageText()` 让其硬编码中文**：把单插件诉求写进宿主，全局影响所有第三方插件，越权且不可持续。
- **删除 en.json 只保留 zh.json**：看似精简，实则触发上述静默失效，中文永不生效且无任何报错提示。

## Consequences

- **收益**：中文界面下插件卡片显示 `dsh git 工作树` / `支持分支操作与工作树功能的dsh插件`，与已本地化插件风格统一；英文界面零回归；插件自身无需改动任何宿主代码即可获得本地化显示名。
- **代价**：新增两个静态 JSON 与 `exports` / `files` 两处打包契约维护点。其中「en.json 是扫描锚点、缺失即静默失效」属于隐式契约，只能靠本文档与提交历史记录，后续维护者若按直觉删除 en.json 会得到一个不报错却不生效的结果。
- **验证方式**：`npm pack` 后对真实解包产物复刻 `readPluginMeta()` 的解析路径（经 `exports` 解析 en.json → 目录扫描 → `localizedText()` 合成 → `resolveText()` 按语言取值），同时断言中文命中与英文回退两侧。
