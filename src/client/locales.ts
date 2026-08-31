/**
 * Locale dictionaries for the git-worktree plugin. zh is the key source; en
 * is `Record<GitWorktreeKey, string>`, so a missing translation fails the
 * build instead of surfacing a raw key.
 */

/** Every copy key the plugin surfaces (chip, dialogs, settings card). */
export type GitWorktreeKey =
  | 'chipWorktree'
  | 'worktreeToggle'
  | 'menuBranches'
  | 'menuLocalBranches'
  | 'menuWorktrees'
  | 'menuRemoteBranches'
  | 'mainRepoOnly'
  | 'menuSearchPlaceholder'
  | 'menuNoMatches'
  | 'menuNoBranches'
  | 'menuLocate'
  | 'menuExpandAll'
  | 'menuCollapseAll'
  | 'menuNewBranch'
  | 'menuNewBranchPlaceholder'
  | 'menuNewBranchBad'
  | 'menuNewBranchExists'
  | 'menuFetch'
  | 'menuUpdate'
  | 'fetchDone'
  | 'updateDone'
  | 'updateUpToDate'
  | 'aheadTitle'
  | 'behindTitle'
  | 'switchAsk'
  | 'switchAskRemote'
  | 'switchBusy'
  | 'worktreeAskNew'
  | 'worktreeAskRemote'
  | 'worktreeAskReuse'
  | 'worktreeAskCutOut'
  | 'worktreeBusy'
  | 'createBranchTitle'
  | 'createBranchBusy'
  | 'actionCancel'
  | 'actionConfirm'
  | 'errorGeneric'
  | 'cardTitle'
  | 'cardDescription'
  | 'cardUnsaved'
  | 'cardExpand'
  | 'cardCollapse'
  | 'cardReadOnly'
  | 'cardRootDirLabel'
  | 'cardBrowse'
  | 'cardPicking'
  | 'cardRootDirHint'
  | 'cardOverridden'
  | 'cardSaveFailed'
  | 'cardDiscard'
  | 'cardSave'
  | 'cardSaving'

/** English dictionary — complete by construction. */
export const en: Record<GitWorktreeKey, string> = {
  chipWorktree: 'Worktree',
  worktreeToggle: 'Create an isolated worktree',
  menuBranches: 'Branches',
  menuLocalBranches: 'Local branches',
  menuWorktrees: 'Worktrees',
  menuRemoteBranches: 'Remote branches',
  mainRepoOnly: 'Branch operations start from the main checkout',
  menuSearchPlaceholder: 'Search branches',
  menuNoMatches: 'No matching branches',
  menuNoBranches: 'No branches yet',
  menuLocate: 'Locate current branch',
  menuExpandAll: 'Expand all',
  menuCollapseAll: 'Collapse all',
  menuNewBranch: 'Create branch from current',
  menuNewBranchPlaceholder: 'New branch name',
  menuNewBranchBad: 'Git will not accept this name',
  menuNewBranchExists: 'A branch with this name already exists',
  menuFetch: 'Fetch',
  menuUpdate: 'Update current branch from upstream',
  fetchDone: 'Remote branches synced',
  updateDone: '{branch} fast-forwarded to its upstream',
  updateUpToDate: 'Already up to date',
  aheadTitle: '{n} commits ahead of upstream',
  behindTitle: '{n} commits behind upstream',
  switchAsk: 'Switch to {branch}?',
  switchAskRemote: 'Check out this remote branch?',
  switchBusy: 'Switching…',
  worktreeAskNew: 'Create a worktree from {branch}?',
  worktreeAskRemote: 'Create a worktree from this remote branch?',
  worktreeAskReuse: 'Switch to the {branch} worktree?',
  worktreeAskCutOut: 'Cut a new branch out of {branch} into an isolated worktree',
  worktreeBusy: 'Creating…',
  createBranchTitle: 'New branch from {branch}',
  createBranchBusy: 'Creating…',
  actionCancel: 'Cancel',
  actionConfirm: 'Confirm',
  errorGeneric: 'Git worktree: {message}',
  cardTitle: 'Git Worktree',
  cardDescription: 'Where isolated worktree folders for new sessions are stored.',
  cardUnsaved: 'Unsaved',
  cardExpand: 'Expand',
  cardCollapse: 'Collapse',
  cardReadOnly: 'The settings document is read-only; edits cannot be saved.',
  cardRootDirLabel: 'Worktree storage folder',
  cardBrowse: 'Browse…',
  cardPicking: 'Choosing…',
  cardRootDirHint: 'Absolute path. Empty uses the default $DSH_HOME/gitworktree (~/.dsh/gitworktree).',
  cardOverridden: '(custom location)',
  cardSaveFailed: 'The change did not save. Check the path is absolute and try again.',
  cardDiscard: 'Discard',
  cardSave: 'Save',
  cardSaving: 'Saving…',
}

/** 中文词典。 */
export const zh: Record<GitWorktreeKey, string> = {
  chipWorktree: '工作树',
  worktreeToggle: '创建隔离工作树',
  menuBranches: '分支',
  menuLocalBranches: '本地分支',
  menuWorktrees: '工作树',
  menuRemoteBranches: '远程分支',
  mainRepoOnly: '分支操作请在主仓库发起',
  menuSearchPlaceholder: '搜索分支',
  menuNoMatches: '没有匹配的分支',
  menuNoBranches: '暂无分支',
  menuLocate: '定位当前分支',
  menuExpandAll: '全部展开',
  menuCollapseAll: '全部折叠',
  menuNewBranch: '从当前分支新建分支',
  menuNewBranchPlaceholder: '新分支名称',
  menuNewBranchBad: 'Git 不接受该名称',
  menuNewBranchExists: '同名分支已存在',
  menuFetch: '提取',
  menuUpdate: '更新当前分支',
  fetchDone: '远程分支已同步',
  updateDone: '{branch} 已快进到远程最新',
  updateUpToDate: '已是最新',
  aheadTitle: '领先上游 {n} 个提交',
  behindTitle: '落后上游 {n} 个提交',
  switchAsk: '是否切到 {branch}？',
  switchAskRemote: '是否检出该远程分支？',
  switchBusy: '切换中…',
  worktreeAskNew: '是否从 {branch} 新建工作树？',
  worktreeAskRemote: '从该远程分支新建工作树？',
  worktreeAskReuse: '是否切到 {branch} 工作树？',
  worktreeAskCutOut: '从当前分支 {branch} 切出新分支到隔离工作树',
  worktreeBusy: '创建中…',
  createBranchTitle: '从 {branch} 新建分支',
  createBranchBusy: '创建中…',
  actionCancel: '取消',
  actionConfirm: '确认',
  errorGeneric: 'Git 工作树：{message}',
  cardTitle: 'Git 工作树',
  cardDescription: '新会话的隔离工作树文件夹存放位置。',
  cardUnsaved: '未保存',
  cardExpand: '展开',
  cardCollapse: '折叠',
  cardReadOnly: '设置文档为只读，修改无法保存。',
  cardRootDirLabel: '工作树存放目录',
  cardBrowse: '浏览…',
  cardPicking: '选择中…',
  cardRootDirHint: '绝对路径。留空使用默认 $DSH_HOME/gitworktree（~/.dsh/gitworktree）。',
  cardOverridden: '（已自定义位置）',
  cardSaveFailed: '保存未生效，请检查路径是否为绝对路径后重试。',
  cardDiscard: '放弃',
  cardSave: '保存',
  cardSaving: '保存中…',
}
