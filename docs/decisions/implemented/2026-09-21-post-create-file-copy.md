# DR: 新建工作树后自动复制 .worktreeinclude 声明的配置文件

Status: implemented

## Problem

新建 worktree 后的目录只包含 Git 追踪的文件。`.env`、`.env.local`、`config/secrets.json` 等被 `.gitignore` 忽略的本地配置文件不会出现在新工作树中，导致项目无法直接运行——用户必须手动从主工作树逐一复制，这是 worktree 使用中最频繁的体验断层。

社区已形成 `.worktreeinclude` 约定文件，声明需要复制到新工作树的文件列表，可入库提交、团队共享。

## Decision

在 `/worktree` 路由创建新工作树成功且实际发生创建（`created: true`，包括普通建树与 cutout 切出）后，自动将指定文件从主工作树（`repoRoot`）复制到新工作树目录。复用已有 worktree（`created: false`）时不触发复制。

- **文件列表来源（二选一，优先级降级）**：
  1. **项目级 `.worktreeinclude`**：优先读取 `<repoRoot>/.worktreeinclude`，逐行解析精确相对路径（`#` 开头为注释，跳过空行）。MVP 阶段不支持 glob 展开和 `!` 否定模式。文件存在时完全取代全局配置，即使内容为空也不降级。
  2. **全局后备 `postCreateCopyFiles`**：插件配置新增 `postCreateCopyFiles: string[]`（支持 Schemastery 校验与 settings 声明），并在设置卡片（`GitWorktreeCard`）提供多行文本编辑界面及 `.worktreeinclude` 优先说明，仅在仓库根不存在 `.worktreeinclude` 时生效。
  3. 两者皆无或解析为空时不触发任何文件复制 I/O。
- **复制与安全规则**：
  - **来源**：始终从主工作树（`repoRoot`）复制，主工作树中不存在的文件静默跳过。
  - **不覆盖**：目标路径已存在同名文件时跳过。
  - **中间目录**：递归自动创建目标路径中缺失的父目录。
  - **安全检查**：拒绝含 `..` 路径段的目录遍历与任何绝对路径，非法项记录失败。
- **失败策略**：
  - 文件复制失败不阻断 worktree 创建（worktree 已建成无法回滚）。
  - 错误汇总通过 `CreateWorktreeResult.copyWarning` 字段返回，客户端 Toast 展示，与 `fetchWarning`/`excludeWarning` 模式一致。
- **架构隔离**：核心文件复制逻辑独立在 `src/copy-files.ts`，纯 I/O Seam 注入实现 100% 可测性。

## Alternatives considered

- **自定义 `.dsh-worktree.yml` 声明文件** —— 需要发明新格式，增加用户学习成本；`.worktreeinclude` 已是社区事实标准且可入库共享，无需重复造轮子。
- **仅全局配置，不读项目级文件** —— 丢失了「跟随仓库提交、团队共享」的能力；不同项目需要复制的文件不同，全局列表难以适配。
- **仅项目级文件，不设全局后备** —— 对不愿在仓库中添加 `.worktreeinclude` 的用户不友好（如个人私有仓库，不想提交额外配置文件）。
- **合并项目级与全局列表（而非降级）** —— 合并语义模糊（去重？追加？冲突？），增加心智负担；降级逻辑简单清晰，`.worktreeinclude` 存在即表示项目已接管。
- **复制失败时阻断并回滚 worktree** —— worktree 已在 Git 中注册且目录已创建，回滚需要反向 `worktree remove`，引入复杂的事务性保证；配置文件缺失是可恢复的（用户手动复制），worktree 丢失不可恢复。
- **支持 post-create 命令执行** —— `pnpm install` 等命令可能耗时数分钟，会阻塞 HTTP 响应；安全边界、超时控制、错误展示均需额外设计，不适合 MVP。

## Consequences

- **代价**：
  - MVP 阶段采用精确路径匹配，不支持 `*.env*` 等 glob 展开，用户若在 `.worktreeinclude` 中写入通配符会因精确文件名不存在而被静默跳过。
  - 大文件或大目录未设容量上限，全量复制依赖用户自觉在列表中指定离散配置文件。
  - 路由契约新增 `copyWarning` 可选字段，客户端需感知并呈现对应 Toast。
- **所得**：
  - 彻底解决了新建工作树后本地环境与配置断层的问题，新创建的 worktree 具备开箱即用运行能力。
  - 支持仓库级共享（`.worktreeinclude`）与个人全局偏好（`postCreateCopyFiles`）两层灵活配置，兼顾团队规范与个人体验。
  - 纯 I/O Seam 与非阻塞式警告设计保证了主流程极高的健壮性与单测确定性。
