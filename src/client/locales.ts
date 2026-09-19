/**
 * Locale dictionaries for the git-worktree plugin. zh is the key source; en
 * is `Record<GitWorktreeKey, string>`, so a missing translation fails the
 * build instead of surfacing a raw key.
 */

/** Every copy key the plugin surfaces (chip, dialogs, settings card). */
export type GitWorktreeKey =
  | 'menuBranches'
  | 'menuLocalBranches'
  | 'menuWorktrees'
  | 'menuRemoteBranches'
  | 'menuSearchPlaceholder'
  | 'menuNoMatches'
  | 'menuNoBranches'
  | 'menuLocate'
  | 'menuExpandAll'
  | 'menuCollapseAll'
  | 'menuNewBranchPlaceholder'
  | 'menuNewBranchBad'
  | 'menuNewBranchExists'
  | 'menuFetch'
  | 'menuUpdate'
  | 'ctxCheckout'
  | 'ctxHop'
  | 'ctxWorktree'
  | 'ctxWorktreeCut'
  | 'ctxCreate'
  | 'ctxCreateCheckout'
  | 'ctxRename'
  | 'ctxDelete'
  | 'ctxCopyName'
  | 'ctxCopyPath'
  | 'renameBranchTitle'
  | 'renameBranchBusy'
  | 'createFlyAsk'
  | 'createFlyAskFrom'
  | 'cutoutFlyAsk'
  | 'createCheckoutConfirm'
  | 'deleteBranchAsk'
  | 'deleteBranchBusy'
  | 'fetchDone'
  | 'updateDone'
  | 'updateUpToDate'
  | 'aheadTitle'
  | 'behindTitle'
  | 'worktreeAskNew'
  | 'worktreeAskRemote'
  | 'worktreeAskReuse'
  | 'worktreeBusy'
  | 'createBranchBusy'
  | 'actionCancel'
  | 'actionConfirm'
  | 'errorGeneric'
  | 'cardDescription'
  | 'cardReadOnly'
  | 'cardRootDirLabel'
  | 'cardLegacyUnused'
  | 'cardRootDirHint'
  | 'cardOverridden'
  | 'cardSaveFailed'
  | 'cardDiscard'
  | 'cardSave'
  | 'cardSaving'
  | 'cardSwitchFailed'
  | 'cardManageWorktrees'
  | 'cardManageHint'
  | 'cardFetchBeforeCreateLabel'
  | 'cardFetchBeforeCreateHint'
  | 'cardAutoPruneLabel'
  | 'cardAutoPruneHint'
  | 'cardKeepWorktreesLabel'
  | 'cardKeepWorktreesHint'
  | 'cardKeepWorktreesBad'
  | 'cardPruneHistoryLabel'
  | 'cardPruneHistoryEmpty'
  | 'cardPruneHistoryRun'
  | 'cardPruneHistoryNone'
  | 'cardPruneHistorySkipped'
  | 'cardPruneHistoryFailed'
  | 'cardPruneHistoryMore'
  | 'cardPruneHistoryLess'
  | 'manager.title'
  | 'manager.loading'
  | 'manager.loadFailed'
  | 'manager.empty'
  | 'manager.count'
  | 'manager.truncated'
  | 'manager.countOrphans'
  | 'manager.orphans'
  | 'manager.sourceProject'
  | 'manager.sourceLegacy'
  | 'manager.activityNever'
  | 'manager.dirty.one'
  | 'manager.dirty.other'
  | 'manager.running'
  | 'manager.purgeMenu'
  | 'manager.purgeAria'
  | 'worktreePurge.title'
  | 'worktreePurge.desc'
  | 'worktreePurge.busy'
  | 'manager.removeAria'
  | 'fetchWarning'
  | 'excludeWarning'
  | 'pruneDone'
  | 'pruneFailed'
  | 'worktreeRemove.menu'
  | 'worktreeRemove.title'
  | 'worktreeRemove.desc'
  | 'worktreeRemove.descBranch'
  | 'worktreeRemove.inspecting'
  | 'worktreeRemove.dirty.one'
  | 'worktreeRemove.dirty.other'
  | 'worktreeRemove.clean'
  | 'worktreeRemove.ahead'
  | 'worktreeRemove.sessions.one'
  | 'worktreeRemove.sessions.other'
  | 'worktreeRemove.busy'
  | 'hover.copied'
  | 'time.now'
  | 'time.minutes'
  | 'time.hours'
  | 'time.days'
  | 'time.months'
  | 'time.years'
  | 'copy'
  | 'close'
  | 'cancel'

/** English dictionary — complete by construction. */
export const en: Record<GitWorktreeKey, string> = {
  menuBranches: 'Branches',
  menuLocalBranches: 'Local branches',
  menuWorktrees: 'Worktrees',
  menuRemoteBranches: 'Remote branches',
  menuSearchPlaceholder: 'Search branches',
  menuNoMatches: 'No matching branches',
  menuNoBranches: 'No branches yet',
  menuLocate: 'Locate current branch',
  menuExpandAll: 'Expand all',
  menuCollapseAll: 'Collapse all',
  menuNewBranchPlaceholder: 'New branch name',
  menuNewBranchBad: 'Git will not accept this name',
  menuNewBranchExists: 'A branch with this name already exists',
  menuFetch: 'Fetch',
  menuUpdate: 'Update current branch from upstream',
  ctxCheckout: 'Check out',
  ctxHop: 'Go to this worktree',
  ctxWorktree: 'Create worktree',
  ctxWorktreeCut: 'New branch and worktree',
  ctxCreate: 'New branch',
  ctxCreateCheckout: 'New branch and check out',
  ctxRename: 'Rename branch',
  ctxDelete: 'Delete branch',
  ctxCopyName: 'Copy branch',
  ctxCopyPath: 'Copy path',
  renameBranchTitle: 'Rename {branch}',
  renameBranchBusy: 'Renaming…',
  createFlyAsk: 'Enter a new branch name',
  createFlyAskFrom: 'New branch from {branch}',
  cutoutFlyAsk: 'Cut a new branch from {branch} into a worktree',
  createCheckoutConfirm: 'Create and check out',
  deleteBranchAsk: 'Delete branch {branch}? Unmerged branches are refused.',
  deleteBranchBusy: 'Deleting…',
  fetchDone: 'Remote branches synced',
  updateDone: '{branch} fast-forwarded to its upstream',
  updateUpToDate: 'Already up to date',
  aheadTitle: '{n} commits ahead of upstream',
  behindTitle: '{n} commits behind upstream',
  worktreeAskNew: 'Create a worktree from {branch}?',
  worktreeAskRemote: 'Create a worktree from this remote branch?',
  worktreeAskReuse: 'Switch to the {branch} worktree?',
  worktreeBusy: 'Creating…',
  createBranchBusy: 'Creating…',
  actionCancel: 'Cancel',
  actionConfirm: 'Confirm',
  errorGeneric: 'Git worktree: {message}',
  cardDescription: 'Branch visibility and git worktree isolation for sessions; new worktrees are created inside their repository.',
  cardReadOnly: 'The settings document is read-only; edits cannot be saved.',
  cardRootDirLabel: 'Legacy storage folder',
  cardLegacyUnused: 'not in use (empty historical location)',
  cardRootDirHint: 'Historical central location, kept only for the worktrees already living there. New worktrees are created at <repo>/.dsh/gitworktree/<branch> inside their repository and locally ignored through .git/info/exclude.',
  cardOverridden: '(custom location)',
  cardSaveFailed: 'The change did not save. Check the path is absolute and try again.',
  cardDiscard: 'Discard',
  cardSave: 'Save',
  cardSaving: 'Saving…',
  cardSwitchFailed: 'This switch did not save. Try again.',
  cardManageWorktrees: 'Manage worktrees…',
  cardManageHint: 'Browse and remove worktrees across repositories — including directories never registered as workspaces.',
  cardFetchBeforeCreateLabel: 'Fetch upstream before creating',
  cardFetchBeforeCreateHint: 'Runs fetch --all --prune before each worktree creation. A failed sync never blocks the creation.',
  cardAutoPruneLabel: 'Auto-remove stale worktrees',
  cardAutoPruneHint: 'Over the cap, creating a worktree removes the least recently used ones (folders only — branches are kept). Uncommitted changes or a running session are never removed.',
  cardKeepWorktreesLabel: 'Worktrees to keep',
  cardKeepWorktreesHint: 'Global cap across all repositories, minimum 1.',
  cardKeepWorktreesBad: 'Enter an integer of at least 1',
  cardPruneHistoryLabel: 'Prune history',
  cardPruneHistoryEmpty: 'No prune runs yet',
  cardPruneHistoryRun: 'Removed {n}:',
  cardPruneHistoryNone: 'Nothing to remove this round',
  cardPruneHistorySkipped: '{n} skipped (uncommitted changes)',
  cardPruneHistoryFailed: '{n} failed',
  cardPruneHistoryMore: 'Show all {n}',
  cardPruneHistoryLess: 'Show less',
  'manager.title': 'Manage worktrees',
  'manager.loading': 'Scanning worktrees…',
  'manager.loadFailed': 'Scan failed: {message}',
  'manager.empty': 'The worktree storage root is empty.',
  'manager.count': '{n} worktree(s)',
  'manager.truncated': 'Too many directories to scan; showing the first batch. Check that the storage folder is set correctly.',
  'manager.countOrphans': ', {n} unrecognized',
  'manager.orphans': 'Unrecognized directories',
  'manager.sourceProject': 'in project',
  'manager.sourceLegacy': 'legacy location',
  'manager.activityNever': 'no sessions',
  'manager.dirty.one': '{n} uncommitted file',
  'manager.dirty.other': '{n} uncommitted files',
  'manager.running': 'A session is running here; removal is unavailable',
  'manager.purgeMenu': 'Delete folder',
  'manager.purgeAria': 'Delete the leftover folder “{path}”',
  'worktreePurge.title': 'Delete leftover folder',
  'worktreePurge.desc': 'This directory has no git record anymore. It will be deleted along with everything in it. This cannot be undone.',
  'worktreePurge.busy': 'Deleting folder…',
  'manager.removeAria': 'Remove the worktree “{path}”',
  fetchWarning: 'Upstream sync failed; created from the local state: {message}',
  excludeWarning: 'The ignore rule for the repository could not be written; `.dsh/` will show as untracked: {message}',
  pruneDone: 'Auto-removed {n} stale worktree(s)',
  pruneFailed: '{n} worktree(s) could not be auto-removed',
  'worktreeRemove.menu': 'Remove worktree',
  'worktreeRemove.title': 'Remove worktree',
  'worktreeRemove.desc': 'This removes the worktree from git and deletes the folder “{path}”.',
  'worktreeRemove.descBranch': 'The branch {branch} is kept.',
  'worktreeRemove.inspecting': 'Inspecting worktree…',
  'worktreeRemove.dirty.one': '{n} uncommitted file will be deleted with the folder.',
  'worktreeRemove.dirty.other': '{n} uncommitted files will be deleted with the folder.',
  'worktreeRemove.clean': 'No uncommitted changes.',
  'worktreeRemove.ahead': '{n} commits ahead of upstream, kept on the branch.',
  'worktreeRemove.sessions.one': '{n} session in this workspace will be archived too.',
  'worktreeRemove.sessions.other': '{n} sessions in this workspace will be archived too.',
  'worktreeRemove.busy': 'Removing…',
  'hover.copied': 'Copied',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
  copy: 'Copy',
  close: 'Close',
  cancel: 'Cancel',
}

/** 中文词典。 */
export const zh: Record<GitWorktreeKey, string> = {
  menuBranches: '分支',
  menuLocalBranches: '本地分支',
  menuWorktrees: '工作树',
  menuRemoteBranches: '远程分支',
  menuSearchPlaceholder: '搜索分支',
  menuNoMatches: '没有匹配的分支',
  menuNoBranches: '暂无分支',
  menuLocate: '定位当前分支',
  menuExpandAll: '全部展开',
  menuCollapseAll: '全部折叠',
  menuNewBranchPlaceholder: '新分支名称',
  menuNewBranchBad: 'Git 不接受该名称',
  menuNewBranchExists: '同名分支已存在',
  menuFetch: '提取',
  menuUpdate: '更新当前分支',
  ctxCheckout: '签出',
  ctxHop: '跳到此工作树',
  ctxWorktree: '创建工作树',
  ctxWorktreeCut: '新建分支并创建工作树',
  ctxCreate: '新建',
  ctxCreateCheckout: '新建并检出',
  ctxRename: '重命名分支',
  ctxDelete: '删除分支',
  ctxCopyName: '复制分支',
  ctxCopyPath: '复制路径',
  renameBranchTitle: '重命名 {branch}',
  renameBranchBusy: '重命名中…',
  createFlyAsk: '输入新分支名称',
  createFlyAskFrom: '从 {branch} 新建分支',
  cutoutFlyAsk: '从 {branch} 切出新分支并创建工作树',
  createCheckoutConfirm: '新建并检出',
  deleteBranchAsk: '是否删除分支 {branch}？未合并的分支会被拒绝。',
  deleteBranchBusy: '删除中…',
  fetchDone: '远程分支已同步',
  updateDone: '{branch} 已快进到远程最新',
  updateUpToDate: '已是最新',
  aheadTitle: '领先上游 {n} 个提交',
  behindTitle: '落后上游 {n} 个提交',
  worktreeAskNew: '是否从 {branch} 新建工作树？',
  worktreeAskRemote: '从该远程分支新建工作树？',
  worktreeAskReuse: '是否切到 {branch} 工作树？',
  worktreeBusy: '创建中…',
  createBranchBusy: '创建中…',
  actionCancel: '取消',
  actionConfirm: '确认',
  errorGeneric: 'Git 工作树：{message}',
  cardDescription: '为会话提供分支可见性与 git 工作树隔离；新建工作树落在各仓库内。',
  cardReadOnly: '设置文档为只读，修改无法保存。',
  cardRootDirLabel: '历史存放目录',
  cardLegacyUnused: '未使用（历史位置为空）',
  cardRootDirHint: '历史集中位置，仅为已有工作树保留。新建工作树落在各仓库内 <repo>/.dsh/gitworktree/<branch>，并通过 .git/info/exclude 本地忽略。',
  cardOverridden: '（已自定义位置）',
  cardSaveFailed: '保存未生效，请检查路径是否为绝对路径后重试。',
  cardDiscard: '放弃',
  cardSave: '保存',
  cardSaving: '保存中…',
  cardSwitchFailed: '该开关未保存，请重试。',
  cardManageWorktrees: '管理工作树…',
  cardManageHint: '跨仓库查看并删除全部工作树，包含从未注册为工作区的目录。',
  cardFetchBeforeCreateLabel: '创建工作树前同步上游',
  cardFetchBeforeCreateHint: '每次创建工作树前先执行 fetch --all --prune 同步远程引用；同步失败不会阻断创建。',
  cardAutoPruneLabel: '自动删除旧工作树',
  cardAutoPruneHint: '超出保留数量时，新建工作树后自动删除最久未用的（只删目录，保留分支）。有未提交改动或进行中会话的不会被删。',
  cardKeepWorktreesLabel: '保留工作树数量',
  cardKeepWorktreesHint: '所有仓库合计的全局上限，最小为 1。',
  cardKeepWorktreesBad: '请输入不小于 1 的整数',
  cardPruneHistoryLabel: '清理记录',
  cardPruneHistoryEmpty: '暂无清理记录',
  cardPruneHistoryRun: '清理了 {n} 个：',
  cardPruneHistoryNone: '本轮无需清理',
  cardPruneHistorySkipped: '{n} 个因未提交改动跳过',
  cardPruneHistoryFailed: '{n} 个失败',
  cardPruneHistoryMore: '展开全部 {n} 条',
  cardPruneHistoryLess: '收起',
  'manager.title': '管理工作树',
  'manager.loading': '正在扫描工作树…',
  'manager.loadFailed': '扫描失败：{message}',
  'manager.empty': '工作树存放目录暂无内容。',
  'manager.count': '{n} 个工作树',
  'manager.truncated': '目录过多，仅显示前一批。请检查存放目录是否设置正确。',
  'manager.countOrphans': '，{n} 个无法识别',
  'manager.orphans': '无法识别的目录',
  'manager.sourceProject': '项目内',
  'manager.sourceLegacy': '历史位置',
  'manager.activityNever': '无会话',
  'manager.dirty.one': '{n} 个未提交文件',
  'manager.dirty.other': '{n} 个未提交文件',
  'manager.running': '有进行中的会话，暂不能删除',
  'manager.purgeMenu': '删除文件夹',
  'manager.purgeAria': '删除残留文件夹“{path}”',
  'worktreePurge.title': '删除残留文件夹',
  'worktreePurge.desc': '该目录已无 git 记录，将连同全部内容一并删除，此操作不可恢复。',
  'worktreePurge.busy': '正在删除文件夹…',
  'manager.removeAria': '删除工作树“{path}”',
  fetchWarning: '上游同步失败，已按本地状态创建：{message}',
  excludeWarning: '仓库忽略规则写入失败，`.dsh/` 将显示为未跟踪目录：{message}',
  pruneDone: '已自动清理 {n} 个旧工作树',
  pruneFailed: '{n} 个工作树自动清理失败',
  'worktreeRemove.menu': '删除工作树',
  'worktreeRemove.title': '删除工作树',
  'worktreeRemove.desc': '将从 git 移除该工作树并删除目录“{path}”。',
  'worktreeRemove.descBranch': '分支 {branch} 将保留。',
  'worktreeRemove.inspecting': '正在检查工作树…',
  'worktreeRemove.dirty.one': '{n} 个未提交文件将随目录一并删除。',
  'worktreeRemove.dirty.other': '{n} 个未提交文件将随目录一并删除。',
  'worktreeRemove.clean': '无未提交改动。',
  'worktreeRemove.ahead': '分支领先上游 {n} 个提交，提交将保留在分支上。',
  'worktreeRemove.sessions.one': '该工作区下的 {n} 个会话将一并归档。',
  'worktreeRemove.sessions.other': '该工作区下的 {n} 个会话将一并归档。',
  'worktreeRemove.busy': '删除中…',
  'hover.copied': '已复制',
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.hours': '{n}小时',
  'time.days': '{n}天',
  'time.months': '{n}个月',
  'time.years': '{n}年',
  copy: '复制',
  close: '关闭',
  cancel: '取消',
}
