# DR: 补充插件矢量图标（icon.svg）与 package.json icon 元数据

Status: implemented

## Problem

DSH 插件管理页支持读取插件包 `package.json` 顶层的 `icon` 字段并在卡片与组件列表中展示专属图标。本插件此前未提供 `icon.svg`，在插件管理页中只能退回宿主默认占位图标，与其他已安装插件混排时辨识度偏弱。

## Decision

1. **新增自包含矢量图标**（[icon.svg](../../../icon.svg)）：
   - 遵循 DSH 插件图标规范：使用 `width="36" height="36" viewBox="0 0 36 36"`，光学边界居中留白，不绘制背景瓷砖（由插件管理页统一提供底板），不使用 `<script>`、`<style>`、`<text>`、`<image>`、`foreignObject` 或事件属性；
   - 以「左侧 Git 分支主干（真透明空心圆环节点 + 蓝紫渐变连线）分叉出右上独立 Worktree 工作区文件夹（青绿渐变）」为主体，直观表达分支可视化与独立 worktree 隔离的核心能力，在浅色与深色主题的 24px 行级和 36px 卡片级尺寸下均保持清晰对比度。
2. **补全 `package.json` 图标元数据**（[package.json](../../../package.json)）：
   - 顶层声明 `"icon": "./icon.svg"`，并在 `"files"` 数组中收录 `"icon.svg"`，确保 npm 发布包携带该资源。
3. **契约单测守护**（[tests/plugin-icon.spec.ts](../../../tests/plugin-icon.spec.ts)）：
   - 断言 `package.json` 的 `icon`、`files` 声明以及 `icon.svg` 的存在性、256 KiB 体积上限、36×36 视口与自包含几何约束。

## Alternatives considered

- **复用或仿制官方 `tool-worktree` 的三方块分支图形**：容易与官方实验性插件视觉混淆，且不如「Git 圆环分支 + 独立文件夹」直观体现 Web UI 工作区隔离。
- **使用 PNG 光栅图标**：高 DPI 缩放清晰度不如矢量 SVG，且体积更大；纯几何 SVG 不足 1.5 KiB。

## Consequences

- 在支持插件图标的 DSH 插件管理页中，本插件展示专属的 Git 分支与工作区图标；不支持 `icon` 字段的旧版宿主安全忽略该字段，无兼容风险。
- 后续若调整图标视觉，需同步确认明暗主题下的渲染对比度，并保持 `tests/plugin-icon.spec.ts` 约束通过。
