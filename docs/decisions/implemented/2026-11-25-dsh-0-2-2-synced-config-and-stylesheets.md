# DR: 对齐 DSH 0.2.2 SyncedConfig 与客户端样式表元数据协议

Status: implemented

## Problem

在将本插件对齐 DSH 0.2.2 上游规范时，有两项客户端运行时与构建协议差异需要以双兼容方式补齐，既兼容旧版宿主（`0.2.0-rc.1` ~ `0.2.2-rc.5`），也对齐新宿主规范：

1. **客户端样式表生命周期**：[tsdown.config.ts](../../../tsdown.config.ts) 此前在每个 `*.module.css` 虚拟模块顶层直接向 `document.head` 注入 `<style data-plugin-css>`，未向 DSH 0.2.2+ 暴露 `window.__ModuleLoader__.load({ id, meta, factory })` 中的 `meta().stylesheets`，且插件卸载或热替换时所有 6 个样式表节点会永久残留在 `<head>` 中。
2. **只读配置同步（`SyncedConfig`）**：Host 端 [src/index.ts](../../../src/index.ts) 的 `Config` 已将全部字段声明为 `.volatile()`；DSH 0.2.2+ 宿主会将其投影为客户端 `apply(ctx, config)` 的第二个参数 `SyncedConfig`。而此前 [src/client/index.ts](../../../src/client/index.ts) 的 `openGraphByDefault`、`autoPruneWorktrees`、`keepWorktrees` 仅通过 `groupingForm.getSnapshot()` 读取，在 `configForms` 尚未就绪时会直接回退为关闭状态。

## Decision

1. **客户端构建产物支持 `meta.stylesheets` 并在旧宿主下于 `ctx.effect` 中管理 fallback 样式**（[tsdown.config.ts](../../../tsdown.config.ts)）：
   - `cssModulesInline` 改为收集编译后的 `{ path, tagId, css }`，模块本身只导出 `classMap`（保留 `moduleSideEffects: 'no-treeshake'`）；
   - 通过 `outputOptions.footer(chunk)` 按 `chunk.modules` 输出标准 `meta().stylesheets`；若宿主未调用 `meta()`（旧宿主），则在包装后的 `apply(ctx, config)` 中通过 `ctx.effect` 挂载 `<style data-plugin-css>` 并在 disposer 中全部移除；若宿主后调用 `meta()`，立即清理已挂载的 fallback `<style>`；同时透传 `apply(ctx, config)` 的 `config` 参数。
2. **客户端 `apply(ctx, config?)` 优先消费 `SyncedConfig`，缺失时回退 `configForms`**（[src/client/index.ts](../../../src/client/index.ts)）：
   - 以结构化鸭子类型声明 `SyncedConfigRefLike` 与 `SyncedConfigLike`（不新增 npm 依赖，不在客户端导出 `Config` schema）；
   - `openGraphByDefault`、`autoPruneWorktrees`、`keepWorktrees` 优先从 `config` 中读取，字段缺失或旧宿主未传 `config` 时无缝回退至 `groupingForm.getSnapshot()`；`GitWorktreeCard` 的表单写操作继续复用 `configForms` + `describe`。
3. **测试守护**（[tests/client-apply.spec.ts](../../../tests/client-apply.spec.ts)、[tests/client-bundle-meta.spec.ts](../../../tests/client-bundle-meta.spec.ts)）：
   - 覆盖 `SyncedConfig` 优先读取与 `configForms` 回退路径；
   - 在纯 Node 环境下加载构建产物 `lib/client.js`，验证新宿主 `meta().stylesheets`、旧宿主 `ctx.effect` 挂载与卸载清理、以及 `apply()` 后调用 `meta()` 清理 fallback 三种场景。

## Alternatives considered

- **直接移除 `<style data-plugin-css>` 仅保留 `meta.stylesheets`**：会导致 `0.2.0-rc.1` ~ `0.2.2-rc.5` 宿主完全丢失组件样式，破坏现有兼容基线。
- **在客户端引入 `@deepseek-ai/dsh-client-config` 依赖**：会抬高构建与宿主版本下限；结构化鸭子类型即可满足静态类型检查与双兼容运行时需求。

## Consequences

- 在 DSH 0.2.2+ 宿主下，样式由 `DocumentStyles` 统一管理且只读开关直接读取 `SyncedConfig`，无样式残留与首帧未就绪窗口。
- 在旧版宿主下，fallback 样式纳入 `ctx.effect` 生命周期管理，插件卸载/禁用时不再残留 `<style>` 节点。
- `tests/client-bundle-meta.spec.ts` 针对构建产物 `lib/client.js` 运行；干净工作树未构建前会自动跳过，执行 `pnpm run build:all && pnpm test` 后完整验证。
