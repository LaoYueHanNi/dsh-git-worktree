# DR: 抓取失败以明文提示代替 git 原话

Status: implemented

## Problem

插件的「提取远程分支」与「更新当前分支」在远程仓库不可用时，把 git 的原话直接抛给用户。真实案例是一个 remote 的地址指向了已被搬走的本地目录：

```
fatal: 'C:\Users\OYW\Documents\MyCode\cc-switch' does not appear to be a git repository
fatal: Could not read from remote repository. Please make sure you have the correct access rights
and the repository exists.
```

这段话有三个问题：

- **不说是哪个 remote**。`git fetch --all` 逐个走远程却从不报远程名；插件的 live 路径也是逐个拉取，同样只把 git 的原文拼在一起。用户看到的是「有个远程坏了」，而仓库里往往有三四个 remote。
- **建议是错的**。本地路径失效时 git 仍说「请确认你有正确的访问权限」，用户会去查密钥和权限，而真正的原因是地址指向了一个已经不在的文件夹。
- **没有下一步**。原文既没说该改什么，也没给出改法。

## Decision

失败的抓取由两段事实拼成一句话：**是哪个 remote、它指向什么地址、下一步做什么**。

- **服务端：点名远程与地址**。live 抓取逐个远程进行，某个远程失败时，在 git 原话前面加一行头：`remote "upstream" (url: C:\Users\OYW\Documents\MyCode\cc-switch)`。地址只在失败之后才读（`git remote get-url`）——成功的拉取不付这次进程的代价。live 路径的逐个拉取见 [DR: 提取与更新的实时进度](2026-10-16-fetch-update-live-progress.md)。
- **客户端：认原因、给明文**。新增 `src/client/fetch-error.ts`，从错误文本里认出五类原因：地址指向的目录已不存在或不是 Git 仓库（`remotePathMissing`）、远程仓库不存在（`remoteNotFound`）、认证失败（`remoteAuthFailed`）、网络或主机不可达（`remoteUnreachable`）、git 没说清的其他失败（`remoteUnknown`）。提示语由 locale 提供，中英文各一份；识别不到的原因仍显示 git 原话。
- **提示给的是可执行命令**。地址失效这一类直接给出两条 git 自己不会提、但都能解决的办法：改地址（`git remote set-url <name> <地址>`），或让这个 remote 不再参与批量抓取（`git config remote.<name>.skipFetchAll true`）。后者是 git 2.36+ 的既有能力，插件的 live 路径本来就读这个配置。
- **不知道远程名时也不编造**。非 live 的 `git fetch --all` 无法说出是哪个远程失败了，此时提示里不出现名字，改说「远程仓库」。

## Alternatives considered

- **只翻译 git 的原话，不点名 remote**——改动更小，但用户拿到的仍是「有个远程坏了」，得自己去 `git remote -v` 查，少掉一半的价值。放弃。
- **在服务端直接改写成中文**——服务端没有 locale，中英文要写两套，且 git 原文会丢失：原文里的具体路径与退出码是排查时的第一手材料。放弃，改成「服务端给结构化事实、客户端说人话」，原文原样保留在服务端。
- **把 remote 与地址放进路由响应体（结构化 RouteError）**——契约更干净，但要动 wire 类型和所有错误出口；这些事实已经以可解析的形式在错误文本里，再建一条并行通道不值得。放弃。
- **坏 remote 不算失败（继续快进）**——这改变「更新当前分支」的语义：现在任一远程失败就中止，用户据此知道仓库有问题。放弃，本决策只改说法、不改行为；行为是否要改是另一件事。
- **给所有失败都套一句通用建议**——不指名的建议等于没指名，抵消了本次改动的全部意义。放弃。

## Consequences

- 用户看到的是一句能照着做的话，而不是一段 `fatal:`；地址失效时不会再被引去检查访问权限。
- 代价：live 抓取失败时多一次 `git remote get-url` 进程——只在失败路径上。服务端错误文本多了一行头；依赖原文格式的下游不受影响（`updateErrorText` 只剥 `git … failed (exit N):` 前缀与 `hint:` 行，这一行头两者都不是）。
- 边界：认出来的原因只有五类，git 还有别的失败方式，那些仍显示原话。需要远程名或地址的提示，在拿不到时降级为不带地址的通用说法，不出现空地址。
- 与快进失败的关系不变：快进失败仍由 [DR: 更新当前分支](2026-08-30-update-current-branch.md) 与 `update-error.ts` 的三类原因负责，本次只管拉取阶段。
