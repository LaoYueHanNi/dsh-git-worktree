# DR: 支持将 PR/MR 一键检出到独立隔离工作树

Status: proposed

## Problem

在日常研发与代码审查（Code Review）流程中，开发者经常需要在本地运行、测试或修改其他协作者提交的 Pull Request (PR) 或 Merge Request (MR)。

目前在插件中检出远程分支时，只能依赖全局 `fetch` 后从「远程分支」列表中手动寻找对应的远程分支名（如 `origin/feature-xxx`），不仅步骤繁琐，而且在外部协作者从 fork 仓库提交 PR 时，其分支并未直接挂载在主仓库的日常分支列表中。用户需要手动执行复杂的命令行拉取（如配置专用 refspec），再为其手动创建工作树；缺乏一站式的“输入 PR 编号或链接，自动建立专属隔离工作树并进入会话”的审查闭环。

## Proposal

在分支菜单中提供「检出 PR/MR 到工作树」能力：

### 1. 混合驱动与优雅降级（CLI 优先 + Git 兜底）

- 优先探测当前宿主环境是否存在官方 CLI 工具（如 GitHub 仓库探测 `gh`）：
  - 若 `gh` 可用且鉴权就绪，优先调用 `gh pr checkout <id>` 获取完整的 PR 元数据。
  - 若 `gh` 不可用或调用失败，无缝降级到纯 Git 原生 fetch：根据远程源类型拉取专用引用（GitHub 为 `refs/pull/<id>/head`，GitLab 为 `refs/merge-requests/<id>/head`），做到零外部依赖环境兜底。

### 2. 灵活输入与智能解析

- 弹窗支持输入纯数字 ID（如 `123`）或完整 Web URL（如 `https://github.com/owner/repo/pull/123`）。
- 解析器自动提取数字 ID，并在用户粘贴 URL 时自动校验是否属于当前仓库的远程源。

### 3. 本地分支与工作树目录命名规范

- 自动根据远程仓库类型添加前缀命名本地分支与存储目录，例如：
  - GitHub PR 命名为 `github-pr-<id>`；
  - GitLab MR 命名为 `gitlab-mr-<id>`；
- 存储路径遵循统一的项目内布局：`<repoRoot>/.dsh/gitworktree/<type>-pr-<id>`。

### 4. 多远程源（Multi-Remote）感知与展示

- 在多远程存在时（如兼有 `upstream` 与 `origin`），在 PR 检出交互中清晰呈现并允许选择目标 Remote；分支菜单整体保持对多远程前缀的清晰展示与区分。

## Alternatives considered

- **强制依赖外部 `gh` / `glab` CLI 工具** —— 大量开发者的本地环境并未安装配置这些官方命令行工具（特别是在 Windows 终端或轻量服务器容器中），强依赖会导致功能在大量环境下不可用。
- **仅使用纯 Git 原生 fetch 方案** —— 纯 Git 方案无法读取 PR 的标题、合并目标基线等增强元数据；有 `gh` 时优先调用可带来更流畅的集成体验。
- **本地分支采用无前缀命名（如纯 `pr-<id>`）** —— 无法区分同一仓库关联的多个不同上游托管源（例如同时存在 github upstream 与内部 gitlab origin），带有平台前缀的命名更加语义化且避免命名碰撞。

## Acceptance criteria

1. 分支菜单中提供直观的「检出 PR」入口弹窗。
2. 支持输入纯数字或完整 URL，非合法格式即时反馈。
3. 当宿主安装 `gh` 且当前为 GitHub 仓库时，优先调用 `gh` 检出；未安装或非 GitHub 场景下，通过原生 `git fetch` 成功拉取目标 ref。
4. 检出成功后，本地生成 `github-pr-<id>`（或对应平台）分支及对应的 `.dsh/gitworktree/` 目录。
5. 空白会话直接接入该工作树工作区，已有会话提示创建完成并提供切换跳转。
6. 测试覆盖 URL 解析提取、平台类型识别、命令组装及降级 fallback 逻辑。

## Risks

- **私有仓库鉴权**：纯 Git 降级模式依赖用户现有的 Git 凭据助手（credential helper）；若未配置凭据，原生 fetch 可能会抛出权限失败，需要将 Git stderr 准确转化为提示文案。
- **Fork 仓库权限**：拉取 fork 提交的 PR 后，本地拥有完整代码并可运行测试，但若用户直接尝试 push，可能受限于远端权限（在文档中声明此工作树主要用于本地审阅与测试）。
