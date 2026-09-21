# DR: 新建工作树后自动复制 .worktreeinclude 声明的配置文件

Status: proposed

## Problem

新建 worktree 后的目录只包含 Git 追踪的文件。`.env`、`.env.local`、`config/secrets.json` 等被 `.gitignore` 忽略的本地配置文件不会出现在新工作树中，导致项目无法直接运行——用户必须手动从主工作树逐一复制，这是 worktree 使用中最频繁的体验断层。

社区已形成 `.worktreeinclude` 约定文件，采用 `.gitignore` 兼容语法声明需要复制到新工作树的文件列表，可入库提交、团队共享。

## Proposal

在 `/worktree` 路由创建新工作树**成功**后（`created: true`），自动将指定文件从主工作树复制到新目录。

### 文件列表来源（二选一，按优先级降级）

1. **项目级 `.worktreeinclude`**：读取 `<repoRoot>/.worktreeinclude`，语法为逐行精确相对路径（`#` 开头为注释，空行跳过），MVP 阶段不支持 glob 展开和 `!` 否定模式。
2. **全局后备 `postCreateCopyFiles`**：插件配置新增 `postCreateCopyFiles: string[]`，仅在仓库根不存在 `.worktreeinclude` 时生效。

`.worktreeinclude` 存在时完全取代全局设置，不合并。

### 复制规则

- **来源**：始终从主工作树（`repoRoot`）复制，主工作树中不存在的文件静默跳过。
- **不覆盖**：目标路径已存在同名文件时跳过（复用已有 worktree 不触发复制）。
- **中间目录**：自动创建目标路径中缺失的父目录（如 `config/secrets.json` 的 `config/`）。
- **安全检查**：拒绝含 `..` 的路径遍历和绝对路径。

### 失败策略

文件复制失败**不阻断** worktree 创建（worktree 已建成无法回滚）。失败信息通过 `CreateWorktreeResult.copyWarning` 字段返回，客户端 Toast 展示——与已有的 `fetchWarning`/`excludeWarning` 模式一致。

### 不做的事

- 不支持 post-create 命令执行（如 `pnpm install`）——安全风险需另行设计。
- 不做 `.gitignore` 语法完整支持（glob、否定、递归匹配）——后续版本按需扩展。
- 不做符号链接或 Reflink/CoW——复杂度与平台限制不值得 MVP 承担。

## Alternatives considered

- **自定义 `.dsh-worktree.yml` 声明文件** —— 需要发明新格式，增加用户学习成本；`.worktreeinclude` 已是社区事实标准且可入库共享，无需重复造轮子。
- **仅全局配置，不读项目级文件** —— 丢失了「跟随仓库提交、团队共享」的能力；不同项目需要复制的文件不同，全局列表难以适配。
- **仅项目级文件，不设全局后备** —— 对不愿在仓库中添加 `.worktreeinclude` 的用户不友好（如个人私有仓库，不想提交额外配置文件）。
- **合并项目级与全局列表（而非降级）** —— 合并语义模糊（去重？追加？冲突？），增加心智负担；降级逻辑简单清晰，`.worktreeinclude` 存在即表示项目已接管。
- **复制失败时阻断并回滚 worktree** —— worktree 已在 Git 中注册且目录已创建，回滚需要反向 `worktree remove`，引入复杂的事务性保证；配置文件缺失是可恢复的（用户手动复制），worktree 丢失不可恢复。
- **支持 post-create 命令执行** —— `pnpm install` 等命令可能耗时数分钟，会阻塞 HTTP 响应；安全边界、超时控制、错误展示均需额外设计，不适合 MVP。

## Acceptance criteria

1. 仓库根存在 `.worktreeinclude` 且列出 `.env` 时，通过 UI 创建新 worktree 后，新目录中出现从主工作树复制的 `.env`。
2. 仓库根无 `.worktreeinclude`、全局设置 `postCreateCopyFiles` 包含 `.env` 时，同样触发复制。
3. 两者均为空时不触发任何文件 I/O。
4. 源文件不存在时静默跳过，无 Toast 错误。
5. 复制失败时 worktree 创建成功，`copyWarning` 出现在 API 响应中，客户端 Toast 展示警告。
6. 复用已有 worktree（`created: false`）时不触发复制。
7. `copy-files.spec.ts` 覆盖解析、安全校验、复制流程全路径。
8. `routes.spec.ts` 扩展覆盖新增的复制集成。

## Risks

- **glob 缺失**：MVP 不支持 `*.env*` 等模式，`.worktreeinclude` 中的 glob 会被当作精确文件名（不存在 → 静默跳过，不会误操作）。用户从 Claude Code 复制来的 `.worktreeinclude` 若依赖 glob 会"静默不工作"——需在文档中说明 MVP 限制。
- **大文件复制**：用户可能将 `.venv/` 等大目录写入列表。MVP 阶段精确路径匹配不支持目录模式，但后续支持 glob 时需考虑大小限制。
- **并发创建竞争**：多个 worktree 同时创建时，读取同一个 `.worktreeinclude` 无竞争问题（只读），但复制到各自目标路径也无冲突（路径不同）。
