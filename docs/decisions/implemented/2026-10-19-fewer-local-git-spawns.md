# DR: 本地只读请求少启动几次 Git

Status: implemented

## Problem

打开分支菜单时，浏览器里一次本地 `GET /status` 要 600ms 左右，接着的 `/history` 约 300ms、`/commit` 约 170ms。这些请求不访问网络。在 Windows 上每启动一次 `git.exe` 就要几十到一百毫秒，而状态、历史和提交详情把多次启动串成了一串，墙钟时间约等于启动次数乘以单次启动成本。

## Decision

`/status` 的仓库探测从六次串行启动收成两轮。第一轮一次 `git rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD`，同时得到仓库根、共享 `.git` 和当前分支；`--abbrev-ref HEAD` 在游离或未出生时打印 `HEAD`，与原来空的 `branch --show-current` 映射成同一个 `HEAD`。第二轮并行跑本地分支（含上游领先/落后）、远程分支和工作树列表。领先/落后仍由 `%(upstream:track)` 计算，不另起进程。

`/history` 在解析分支尖端时，把 `check-ref-format` 和 `rev-parse` 放在同一轮。已经带 tip 的翻页仍只校验引用格式，不再解析。

`/commit` 用一次 `git show --first-parent --numstat --no-renames --no-relative` 同时取出正文和第一父提交口径的文件统计。根提交仍是相对空树的完整差异，合并提交仍只比第一父。文件名继续按 NUL 分隔。

## Alternatives considered

**只给 /status 做结果缓存**：分支一更新就要失效，而这次的时间几乎全花在进程启动上，合并和并行直接少启动，不引入另一份会过期的状态。

**去掉 `%(upstream:track)` 让分支列表更快**：领先/落后是分支行上的现成标记，改成事后逐支计算会更多次启动。分支很多时这一步仍可能是状态请求里最慢的一段，但不再叠上五次空等。

## Consequences

本仓库实测单次 Git 启动约 55ms。状态从约六次串行变成一轮探测加三路并行，历史从三次变成两轮，提交详情从两次变成一次。领先/落后很多的仓库，状态请求仍要等那一次 `for-each-ref` 算完。语义和返回字段不变。
