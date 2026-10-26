# DR: PR 必须关联 issue 的 CI 检查

Status: implemented

## Problem

仓库所有合并都由维护者一人直接操作，改动动机散落在提交信息里，没有 issue 承载"为什么改"，事后回溯（尤其 AI 会话冷启动翻历史）缺少第一手上下文；且 GitHub 没有提供原生的"PR 必须关联 issue"开关，无法在仓库设置里一劳永逸地配置强制。

## Decision

新增 `.github/workflows/require-issue.yml`：在 PR `opened` / `edited` / `reopened` 时，把标题与描述拼接后用 `grep -E '#[0-9]+'` 检查是否含 issue 引用，缺失则发出 `::error` 注解并 `exit 1`，以红叉形式暴露在 PR 上（workflow 注释保留"配合 main 分支保护规则强制执行"的升级路径说明）。本仓库仅一名维护者，**不启用分支保护规则**——检查失败不硬拦合并，约束落在合并把关这一步，由维护者在红叉可见的前提下自行决定。

## Alternatives considered

- **启用 main 分支保护规则并 require 该 status check** —— 硬拦最彻底，但单人仓库每次合并都须等检查跑完，误报时还要进设置临时放行，管理开销大于收益；留作多人协作时的升级路径。当前放弃。
- **调 GitHub API 查 PR 的 closing-keyword 关联（linked issue）** —— 合并进默认分支前关联状态不可靠，body 忘写 `Closes #N` 就查不到；文本正则只认"写了 `#<数字>` 引用"这一件事，简单可预期。放弃。
- **引入 marketplace 现成 action** —— 多一个第三方依赖与供应链审查面，十几行 shell 已覆盖需求。放弃。

## Consequences

- 得：每条 PR 的动机有 issue 承载、可回溯；补写引用后检查随 `edited` 事件自动重跑转绿；零第三方依赖。
- 代价：正则不校验 issue 真实存在或未关闭，"提及"即通过；不启用分支保护期间检查失败仍可强行合并——属有意取舍，把关收在合并动作本身。
