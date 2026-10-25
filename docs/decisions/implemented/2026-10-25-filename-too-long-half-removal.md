# DR: Windows 长路径半移除纳入删除兜底

Status: implemented

## Problem

`git worktree remove` 在 Windows 上先注销注册、再递归删树，删树半途失败就留下"注册已消失、目录半残"的现场。删除兜底（`isDirBusyGitError` 分类 + `fsSweepDir` 清扫）只认文件占用形态（`Permission denied`/`EPERM`/`EACCES`/`EBUSY`），不认长路径形态：工作树里装过 npm 依赖时，`<repo>/.dsh/gitworktree/<name>/node_modules/…` 的深链超过 Win32 的 260 字符上限，git 以 `error: failed to delete '…': Filename too long`（ENAMETOOLONG）半途而废。该错误文本不匹配分类，兜底链条不启动——残留留盘、UI 只报错，用户须到管理弹窗手动点"删除文件夹"收尾（实测案例：dsh-token-usage 的 feature/magpie-support-quote 工作树）。系统 `LongPathsEnabled` 开关救不了 git.exe（其 manifest 未声明 longPathAware），git 只有在 `core.longpaths` 开启时才自行做 `\\?\` 转换。

## Decision

两处扩展，长路径形态与占用形态走同一条半移除收尾链：

1. `isDirBusyGitError`（src/git.ts）加 `/filename too long/i`——git 的报错文本进入同一分类，其后"重新列举确认注册已注销 → sweep 残留 → 残留仍占则拒绝"的原有流程原样复用，无新增分支。
2. `fsSweepDir` 的 `fs.rm` 走 `asExtendedLengthPath`：win32 下把绝对路径转为 `\\?\` 扩展长度形式（UNC 转 `\\?\UNC\…`、已带前缀原样、POSIX 原样），绕开 260 字符规范化，让深层 unlink/rmdir 真正删得动；`existsSync`/`readdirSync` 的分类读取不变（libuv 对超长路径自动加前缀）。

与 [DR: 创建前同步上游、惰性清理旧工作树与设置页工作树管理](2026-09-13-worktree-prune-and-manager.md) 的"残留文件夹清除"（`POST /purge`）的关系：那是用户手动兜底入口，本决策让兜底在删除流程内自动完成，purge 仍是其他来源残根的出口。

## Alternatives considered

- **引导用户全局开 `core.longpaths`**——git 自身的文件操作随即支持长路径，多数场景根治；但这是用户机器的全局配置，插件无权替用户改，未开启的机器上该形态照旧漏。作为文档化的缓解记录，不作为代码修复。
- **sweeper 改用外部进程（robocopy 镜像空目录等）**——每轮清理多一次进程 spawn，且与现有纯 Node 实现并存两套删除语义；一个 `\\?\` 前缀就够。放弃。
- **删除工作树前预防性清空 node_modules**——为了一个形态遍历整树，还剥夺用户在确认弹窗后保留文件的机会。放弃。

## Consequences

- 得：`Filename too long` 半移除自动收尾，管理弹窗不再出现"删了但没删净"的无法识别残留（来自删除流程的）；超过 260 字符的真实文件系统测试（60 层深链 + 断言路径长度越限）锁住行为。
- 代价：`\\?\` 路径不做任何规范化，`fsSweepDir` 入参必须是规范绝对路径——调用方 `removeWorktree` 传入的路径已 `normalize`，函数内部再 `resolve` 兜底；分类读取仍依赖 libuv 的自动长路径处理，若未来 Node/libuv 行为变化，`empty`/`occupied` 分类对超长残根可能失真，届时给读取补同一前缀即可。
