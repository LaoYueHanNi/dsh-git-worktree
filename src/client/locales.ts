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
  | 'sidebarSectionTitle'
  | 'sidebarAddSession'
  | 'sidebarNewSession'
  | 'sidebarMainBranch'
  | 'sidebarMain'
  | 'sidebarRailExpand'
  | 'cardGroupSidebarLabel'
  | 'cardGroupSidebarHint'
  | 'cardGroupSidebarMark'
  | 'cardGroupSidebarNote'
  | 'cardGroupSidebarBusy'
  | 'group.ungrouped'
  | 'session.new'
  | 'section.workspaces'
  | 'section.sessions'
  | 'viewOptions.label'
  | 'groupBy.label'
  | 'groupBy.workspace'
  | 'groupBy.flat'
  | 'orderBy.label'
  | 'orderBy.manual'
  | 'orderBy.updated'
  | 'sessions.expand'
  | 'sessions.collapse'
  | 'empty.none'
  | 'empty.noMatches'
  | 'workspace.add'
  | 'search'
  | 'search.sessions.aria'
  | 'search.placeholder'
  | 'search.clear'
  | 'search.results.aria'
  | 'search.pending'
  | 'search.unavailable'
  | 'search.noMatches'
  | 'search.hasMore'
  | 'menu.addWorkspace'
  | 'picker.loading'
  | 'conflict.named'
  | 'folderError.title'
  | 'folderError.retry'
  | 'rename'
  | 'rename.workspace.title'
  | 'rename.session.title'
  | 'field.workspaceName'
  | 'field.sessionName'
  | 'delete.workspace'
  | 'delete.desc'
  | 'delete.pending'
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
  | 'stray.unknown'
  | 'stray.belongsTo'
  | 'stray.register'
  | 'stray.register.aria'
  | 'stray.registerFailed'
  | 'menu.fork'
  | 'menu.archiveSession'
  | 'sessions.count.one'
  | 'sessions.count.other'
  | 'actions.workspace.aria'
  | 'actions.session.aria'
  | 'actions.newSession.aria'
  | 'status.running'
  | 'status.subagentsRunning.one'
  | 'status.subagentsRunning.other'
  | 'status.idle'
  | 'status.waitingApproval'
  | 'status.planReview'
  | 'status.waitingAnswer'
  | 'status.completed'
  | 'hover.created'
  | 'hover.copied'
  | 'date.ymd'
  | 'time.now'
  | 'time.minutes'
  | 'time.hours'
  | 'time.days'
  | 'time.months'
  | 'time.years'
  | 'time.ago'
  | 'copy'
  | 'close'
  | 'cancel'

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
  sidebarSectionTitle: 'Workspaces',
  sidebarAddSession: 'Start a new session',
  sidebarNewSession: 'New Session',
  sidebarMainBranch: 'Main ({branch})',
  sidebarMain: 'Main',
  sidebarRailExpand: 'Expand sidebar',
  cardGroupSidebarLabel: 'Group workspaces',
  cardGroupSidebarHint: 'DSH does not yet expose a multi-workspace grouping API, so this replaces the native sidebar 1:1 and adds same-repo worktree grouping.',
  cardGroupSidebarMark: '(experimental)',
  cardGroupSidebarNote: 'Turn it off to restore the native list if anything breaks; we will switch to the official API as soon as it ships.',
  cardGroupSidebarBusy: 'Switching sidebar…',
  'group.ungrouped': 'Ungrouped',
  'session.new': 'New Session',
  'section.workspaces': 'Workspaces',
  'section.sessions': 'Sessions',
  'viewOptions.label': 'View options',
  'groupBy.label': 'Group by',
  'groupBy.workspace': 'WorkSpace',
  'groupBy.flat': 'In one list',
  'orderBy.label': 'Order by',
  'orderBy.manual': 'Manual',
  'orderBy.updated': 'Last updated',
  'sessions.expand': 'Show {n} more sessions',
  'sessions.collapse': 'Show less',
  'empty.none': 'No sessions yet',
  'empty.noMatches': 'No matches',
  'workspace.add': 'Add workspace',
  search: 'Search',
  'search.sessions.aria': 'Search sessions',
  'search.placeholder': 'Search sessions...',
  'search.clear': 'Clear search',
  'search.results.aria': 'Search results',
  'search.pending': 'Searching session history…',
  'search.unavailable': 'Content search is temporarily unavailable. Showing name matches.',
  'search.noMatches': 'No matching sessions',
  'search.hasMore': 'Showing the first {n} results. Narrow your search.',
  'menu.addWorkspace': 'Add workspace…',
  'picker.loading': 'Loading workspaces…',
  'conflict.named': 'A workspace named “{name}” already exists.',
  'folderError.title': 'Couldn’t open folder',
  'folderError.retry': 'Choose again',
  rename: 'Rename',
  'rename.workspace.title': 'Rename workspace',
  'rename.session.title': 'Rename session',
  'field.workspaceName': 'Workspace name',
  'field.sessionName': 'Session name',
  'delete.workspace': 'Delete workspace',
  'delete.desc': 'This removes “{name}” from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.',
  'delete.pending': 'Deleting workspace…',
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
  'stray.unknown': '(unknown directory)',
  'stray.belongsTo': 'Stray sessions of “{name}”',
  'stray.register': 'Register as workspace',
  'stray.register.aria': 'Register “{name}” as a workspace',
  'stray.registerFailed': 'Registration failed: {message}',
  'menu.fork': 'Fork session',
  'menu.archiveSession': 'Archive session',
  'sessions.count.one': '{n} session',
  'sessions.count.other': '{n} sessions',
  'actions.workspace.aria': 'Workspace actions for {name}',
  'actions.session.aria': 'Session actions for {name}',
  'actions.newSession.aria': 'New session in {name}',
  'status.running': 'Running',
  'status.subagentsRunning.one': '{n} subagent running',
  'status.subagentsRunning.other': '{n} subagents running',
  'status.idle': 'Idle',
  'status.waitingApproval': 'Waiting for approval',
  'status.planReview': 'Plan awaiting review',
  'status.waitingAnswer': 'Waiting for answer',
  'status.completed': 'Completed',
  'hover.created': 'Created {time}',
  'hover.copied': 'Copied',
  'date.ymd': '{y}-{m}-{d}',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
  'time.ago': '{t} ago',
  copy: 'Copy',
  close: 'Close',
  cancel: 'Cancel',
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
  sidebarSectionTitle: '工作区',
  sidebarAddSession: '发起新会话',
  sidebarNewSession: '新会话',
  sidebarMainBranch: '主仓库（{branch}）',
  sidebarMain: '主仓库',
  sidebarRailExpand: '展开侧栏',
  cardGroupSidebarLabel: '聚合工作区',
  cardGroupSidebarHint: 'DSH 尚未开放多工作区聚合接口，因此按原生侧边栏 1:1 替换左侧列表，并加上同仓库工作树分组。',
  cardGroupSidebarMark: '（测试功能）',
  cardGroupSidebarNote: '使用中若遇问题，关掉即可回到原生；官方接口一旦开放，会第一时间改用原生实现。',
  cardGroupSidebarBusy: '正在切换侧栏…',
  'group.ungrouped': '未分组',
  'session.new': '新会话',
  'section.workspaces': '工作区',
  'section.sessions': '会话',
  'viewOptions.label': '视图选项',
  'groupBy.label': '分组方式',
  'groupBy.workspace': '按工作区',
  'groupBy.flat': '单列表',
  'orderBy.label': '排序方式',
  'orderBy.manual': '手动排序',
  'orderBy.updated': '最近更新',
  'sessions.expand': '展开其余 {n} 个会话',
  'sessions.collapse': '收起',
  'empty.none': '暂无会话',
  'empty.noMatches': '无匹配结果',
  'workspace.add': '添加工作区',
  search: '搜索',
  'search.sessions.aria': '搜索会话',
  'search.placeholder': '搜索会话…',
  'search.clear': '清除搜索',
  'search.results.aria': '搜索结果',
  'search.pending': '正在搜索会话历史…',
  'search.unavailable': '内容搜索暂不可用，仅显示名称匹配。',
  'search.noMatches': '无匹配会话',
  'search.hasMore': '仅显示前 {n} 条结果，请缩小搜索范围。',
  'menu.addWorkspace': '添加工作区…',
  'picker.loading': '正在加载工作区…',
  'conflict.named': '已存在名为“{name}”的工作区。',
  'folderError.title': '无法打开文件夹',
  'folderError.retry': '重新选择',
  rename: '重命名',
  'rename.workspace.title': '重命名工作区',
  'rename.session.title': '重命名会话',
  'field.workspaceName': '工作区名称',
  'field.sessionName': '会话名称',
  'delete.workspace': '删除工作区',
  'delete.desc': '将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。',
  'delete.pending': '正在删除工作区…',
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
  'stray.unknown': '（目录未知）',
  'stray.belongsTo': '属于“{name}”的失联会话',
  'stray.register': '注册为工作区',
  'stray.register.aria': '将“{name}”注册为工作区',
  'stray.registerFailed': '注册失败：{message}',
  'menu.fork': '分叉会话',
  'menu.archiveSession': '归档会话',
  'sessions.count.one': '{n} 个会话',
  'sessions.count.other': '{n} 个会话',
  'actions.workspace.aria': '工作区“{name}”的操作',
  'actions.session.aria': '会话“{name}”的操作',
  'actions.newSession.aria': '在“{name}”中新建会话',
  'status.running': '进行中',
  'status.subagentsRunning.one': '{n} 个子代理运行中',
  'status.subagentsRunning.other': '{n} 个子代理运行中',
  'status.idle': '空闲',
  'status.waitingApproval': '等待审批',
  'status.planReview': '计划待审',
  'status.waitingAnswer': '等待回答',
  'status.completed': '已完成',
  'hover.created': '创建于 {time}',
  'hover.copied': '已复制',
  'date.ymd': '{y}年{m}月{d}日',
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.hours': '{n}小时',
  'time.days': '{n}天',
  'time.months': '{n}个月',
  'time.years': '{n}年',
  'time.ago': '{t}前',
  copy: '复制',
  close: '关闭',
  cancel: '取消',
}
