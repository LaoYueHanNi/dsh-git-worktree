/**
 * Locale dictionaries for the git-worktree plugin. zh is the key source; en
 * is `Record<GitWorktreeKey, string>`, so a missing translation fails the
 * build instead of surfacing a raw key.
 */

/** Every copy key the plugin surfaces (chip, dialogs, settings card). */
export type GitWorktreeKey =
  | 'graphTitle'
  | 'graphDetail'
  | 'graphNoBody'
  | 'graphExpandBody'
  | 'graphCollapseBody'
  | 'graphNoFiles'
  | 'graphFiles'
  | 'graphBinary'
  | 'graphRefresh'
  | 'graphCloseWindow'
  | 'graphToggleOpen'
  | 'graphToggleClose'
  | 'graphShowBranches'
  | 'graphHideBranches'
  | 'graphSearch'
  | 'graphSearchPlaceholder'
  | 'graphAuthorFilter'
  | 'graphAllAuthors'
  | 'graphColumn'
  | 'graphCommit'
  | 'graphAuthor'
  | 'graphDate'
  | 'graphCommits'
  | 'graphNoMatches'
  | 'graphEmpty'
  | 'graphLoading'
  | 'graphLoaded'
  | 'graphRetry'
  | 'graphMore'
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
  | 'cutoutNewBranchPlaceholder'
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
  | 'updateFailDiverged'
  | 'updateFailDirty'
  | 'updateFailNoUpstream'
  | 'fetchFailRemotePathMissing'
  | 'fetchFailRemoteNotFound'
  | 'fetchFailRemoteAuthFailed'
  | 'fetchFailRemoteUnreachable'
  | 'fetchFailRemoteUnknown'
  | 'fetchFailRemoteUnnamed'
  | 'syncTitleFetch'
  | 'syncTitleUpdate'
  | 'syncTitlePush'
  | 'syncConnecting'
  | 'syncMerging'
  | 'syncCancel'
  | 'fetchCancelled'
  | 'updateCancelled'
  | 'pushCancelled'
  | 'aheadTitle.one'
  | 'aheadTitle.other'
  | 'behindTitle.one'
  | 'behindTitle.other'
  | 'unpublishedTitle'
  | 'upstreamGoneTitle'
  | 'ctxPush'
  | 'pushTitle'
  | 'pushEditTarget'
  | 'pushEditTargetClose'
  | 'pushApplyEnter'
  | 'pushNew'
  | 'pushEmpty'
  | 'pushNewEmpty'
  | 'pushCommitCount.one'
  | 'pushCommitCount.other'
  | 'pushFailBehind'
  | 'pushFailStale'
  | 'pushFailHook'
  | 'pushFailRefused'
  | 'pushFailAuth'
  | 'pushCommitList'
  | 'pushTruncated'
  | 'pushTags'
  | 'pushTagsAll'
  | 'pushTagsFollow'
  | 'pushTagsAllHint'
  | 'pushTagsFollowHint'
  | 'pushForce'
  | 'pushForceHint'
  | 'pushOptions'
  | 'pushRefresh'
  | 'pushBranch'
  | 'pushPlanning'
  | 'pushCheckingRemote'
  | 'pushLocalChecking'
  | 'pushLocalUnverified'
  | 'pushLocalEmpty'
  | 'pushReadingCommits'
  | 'pushBusy'
  | 'pushDone'
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
  | 'cardOpenGraphLabel'
  | 'cardOpenGraphHint'
  | 'cardHideOfficialWorktreeLabel'
  | 'cardHideOfficialWorktreeHint'
  | 'cardSwitchSessionDirLabel'
  | 'cardSwitchSessionDirHint'
  | 'cardManageOfficialWorktreesLabel'
  | 'cardManageOfficialWorktreesHint'
  | 'cardManageWorktrees'
  | 'cardManageHint'
  | 'cardFetchBeforeCreateLabel'
  | 'cardFetchBeforeCreateHint'
  | 'cardAutoPruneLabel'
  | 'cardAutoPruneHint'
  | 'cardKeepWorktreesLabel'
  | 'cardKeepWorktreesHint'
  | 'cardKeepWorktreesBad'
  | 'cardPostCreateCopyFilesLabel'
  | 'cardPostCreateCopyFilesPlaceholder'
  | 'cardPostCreateCopyFilesHint'
  | 'cardPostCreateCopyFilesBad'
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
  | 'manager.sourceOfficial'
  | 'manager.sourceLegacy'
  | 'manager.modeStandalone'
  | 'manager.modeSession'
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
  | 'manager.refresh'
  | 'manager.openSession'
  | 'manager.openSessionOfficialHint'
  | 'manager.copyPath'
  | 'manager.openFailed'
  | 'manager.scopeRepo'
  | 'manager.showAllRepos'
  | 'manager.scopeBack'
  | 'manager.emptyScoped'
  | 'contextMenu.newWorktree'
  | 'contextMenu.checkoutPr'
  | 'contextMenu.manageWorktrees'
  | 'contextMenu.removeWorktree'
  | 'contextMenu.removeDone'
  | 'menuCheckoutPr'
  | 'prModal.title'
  | 'prModal.subtitle'
  | 'prModal.loading'
  | 'prModal.loadingRemote'
  | 'prModal.loadFailed'
  | 'prModal.inputPlaceholder'
  | 'prModal.remoteLabel'
  | 'prModal.providerLabel'
  | 'prModal.providerGithub'
  | 'prModal.providerGitlab'
  | 'prModal.forgeUnauth'
  | 'prModal.filterReviewRequested'
  | 'prModal.filterAuthored'
  | 'prModal.filterInvolved'
  | 'prModal.noCandidates'
  | 'prModal.tagDraft'
  | 'prModal.tagWorktree'
  | 'prModal.ciSuccess'
  | 'prModal.ciPending'
  | 'prModal.ciFailure'
  | 'prModal.resolving'
  | 'prModal.previewHeading'
  | 'prModal.previewRef'
  | 'prModal.previewBranch'
  | 'prModal.previewPath'
  | 'prModal.existingHeading'
  | 'prModal.existingReuse'
  | 'prModal.existingUpdate'
  | 'prModal.divergedTitle'
  | 'prModal.divergedDesc'
  | 'prModal.divergedKeep'
  | 'prModal.divergedReset'
  | 'prModal.occupiedByMain'
  | 'prModal.autoTrack'
  | 'prModal.submitCreate'
  | 'prModal.submitOpen'
  | 'prModal.submitUpdate'
  | 'prModal.stageFetch'
  | 'prModal.stageWorktree'
  | 'prModal.stageCopy'
  | 'prModal.busy'
  | 'prModal.busyOpen'
  | 'prModal.busyUpdate'
  | 'prModal.updatedToast'
  | 'prModal.forceUpdatedToast'
  | 'prModal.resetToast'
  | 'prModal.upToDateToast'
  | 'prModal.preservedLocalBranchToast'
  | 'prModal.forkPushNote'
  | 'prModal.noRemotes'
  | 'prModal.errNoRemotes'
  | 'prModal.errEmptyInput'
  | 'prModal.errInvalidInput'
  | 'prModal.errUnsupportedProvider'
  | 'prModal.errUrlRepoMismatch'
  | 'prModal.errRemoteNotFound'
  | 'prModal.errProviderUndetected'
  | 'prModal.errWorktreeDirty'
  | 'prModal.errPrRefNotFound'
  | 'prModal.errPrAuthFailed'
  | 'forgeSlot.checkoutTooltip'
  | 'forgeSlot.checkoutLabel'
  | 'forgeSlot.syncTooltip'
  | 'forgeSlot.syncLabel'
  | 'sidebar.worktreeBadge'
  | 'sidebar.worktreeBadgeWithBranch'
  | 'sidebar.worktreeHover'
  | 'sidebar.worktreeHoverWithBranch'
  | 'sidebar.worktreeHoverLabel'
  | 'sidebar.worktreeHoverFrom'
  | 'sidebar.worktreeHoverPr'
  | 'createModal.title'
  | 'createModal.loading'
  | 'createModal.loadFailed'
  | 'createModal.searchPlaceholder'
  | 'createModal.cutFromBranch'
  | 'createModal.noMatches'
  | 'createModal.tagCurrent'
  | 'createModal.tagWorktree'
  | 'createModal.tagRemote'
  | 'createModal.creating'
  | 'deferred.armedTitle'
  | 'deferred.armedRandom'
  | 'deferred.armedCutout'
  | 'deferred.armedBranch'
  | 'deferred.armedPr'
  | 'deferred.armedCancel'
  | 'deferred.runningTitle'
  | 'deferred.failedTitle'
  | 'deferred.phaseFetch'
  | 'deferred.phaseCreate'
  | 'deferred.phaseCopy'
  | 'deferred.phaseSwitch'
  | 'deferred.labelBranch'
  | 'deferred.labelBase'
  | 'deferred.labelReason'
  | 'deferred.waitingNote'
  | 'deferred.retry'
  | 'deferred.withdraw'
  | 'fetchWarning'
  | 'excludeWarning'
  | 'copyWarning'
  | 'gitFailSwitchDirty'
  | 'gitFailSwitchMissing'
  | 'gitFailDeleteUnmerged'
  | 'gitFailDeleteCheckedOut'
  | 'gitFailWorktreeOccupied'
  | 'gitFailWorktreePathExists'
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
  graphTitle: 'Commit graph',
  graphDetail: 'Commit details',
  graphNoBody: 'This commit has no body',
  graphExpandBody: 'Expand body',
  graphCollapseBody: 'Collapse body',
  graphNoFiles: 'No file changes',
  graphFiles: '{count} files',
  graphBinary: '{count} binary files',
  graphRefresh: 'Refresh history',
  graphCloseWindow: 'Close popup',
  graphToggleOpen: 'Open graph',
  graphToggleClose: 'Close graph',
  graphShowBranches: 'Show branches',
  graphHideBranches: 'Hide branches',
  graphSearch: 'Search',
  graphSearchPlaceholder: 'Text or hash',
  graphAuthorFilter: 'Filter by author',
  graphAllAuthors: 'All authors',
  graphColumn: 'Graph',
  graphCommit: 'Commit',
  graphAuthor: 'Author',
  graphDate: 'Date',
  graphCommits: 'Commit history',
  graphNoMatches: 'No matching commits',
  graphEmpty: 'No commits on this branch',
  graphLoading: 'Loading commits…',
  graphLoaded: '{count} commits loaded',
  graphRetry: 'Retry',
  graphMore: 'Load more',
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
  cutoutNewBranchPlaceholder: 'New branch name (blank = random)',
  menuNewBranchBad: 'Git will not accept this name',
  menuNewBranchExists: 'A branch with this name already exists',
  menuFetch: 'Fetch',
  menuUpdate: 'Update',
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
  updateFailDiverged: 'The branch has diverged. Merge or rebase its upstream first.',
  updateFailDirty: 'Uncommitted changes would be overwritten by the fast-forward. Commit or stash them, then update again.',
  updateFailNoUpstream: 'This branch has no upstream to update from. Push it and set an upstream first.',
  fetchFailRemotePathMissing: 'Remote {remote} points at a folder that is gone or is not a Git repository: {path}. Point it at a valid address (git remote set-url {remote} <url>), or leave it out of bulk fetches (git config remote.{remote}.skipFetchAll true).',
  fetchFailRemoteNotFound: 'Remote {remote} was not found at {url}. Check the address, or that you still have access.',
  fetchFailRemoteAuthFailed: 'Remote {remote} refused the connection: authentication failed. Check your credentials or SSH key.',
  fetchFailRemoteUnreachable: 'Remote {remote} could not be reached: {url}. Check the network and the address.',
  fetchFailRemoteUnknown: 'Remote {remote} could not be fetched.',
  fetchFailRemoteUnnamed: 'repository',
  syncTitleFetch: 'Fetching remote branches',
  syncTitleUpdate: 'Updating {branch}',
  syncTitlePush: 'Pushing {branch}',
  syncConnecting: 'Connecting to the remote…',
  syncMerging: 'Fast-forwarding {branch}…',
  syncCancel: 'Cancel',
  fetchCancelled: 'Fetch cancelled',
  updateCancelled: 'Update cancelled',
  pushCancelled: 'Push cancelled',
  'aheadTitle.one': '{n} commit ahead of upstream',
  'aheadTitle.other': '{n} commits ahead of upstream',
  'behindTitle.one': '{n} commit behind upstream',
  'behindTitle.other': '{n} commits behind upstream',
  unpublishedTitle: 'Not pushed — no upstream configured',
  upstreamGoneTitle: 'Upstream {upstream} no longer exists; choose a push destination',
  ctxPush: 'Push',
  pushTitle: 'Push',
  pushEditTarget: 'Edit target branch',
  pushEditTargetClose: 'Close without applying',
  pushApplyEnter: 'Press Enter to apply',
  pushNew: 'New',
  pushEmpty: 'No commits to push',
  pushNewEmpty: 'This branch will be created on the remote',
  'pushCommitCount.one': '{n} commit',
  'pushCommitCount.other': '{n} commits',
  pushFailBehind: 'The remote branch has commits you do not have locally. Update the branch first, or use Force push to overwrite them.',
  pushFailStale: 'The remote branch changed after the preview. The preview was refreshed; review it and push again.',
  pushFailHook: 'A local pre-push hook refused this push. See the details below.',
  pushFailRefused: 'The remote refused the update (for example a protected branch or a server-side hook). See the details below.',
  pushFailAuth: 'Authentication failed. Check your Git credentials or SSH key; the plugin cannot prompt for a password.',
  pushCommitList: 'Commits to push',
  pushTruncated: 'Showing the first {n} commits',
  pushTags: 'Push tags',
  pushTagsAll: 'All',
  pushTagsFollow: 'Follow commits',
  pushTagsAllHint: 'Push all local Git tags, including tags unrelated to this branch',
  pushTagsFollowHint: 'Push missing annotated tags reachable from the pushed history; excludes lightweight tags',
  pushForce: 'Force push',
  pushForceHint: 'Uses force-with-lease; refuses to overwrite remote changes made after preview',
  pushOptions: 'Push options',
  pushRefresh: 'Refresh push preview',
  pushBranch: 'Remote branch name',
  pushPlanning: 'Reading local commits…',
  pushCheckingRemote: 'Checking remote destination…',
  pushLocalChecking: 'Local preview · checking remote…',
  pushLocalUnverified: 'Local preview · remote unverified',
  pushLocalEmpty: 'No commits found in the local preview',
  pushReadingCommits: 'Reading commit messages…',
  pushBusy: 'Pushing…',
  pushDone: '{branch} pushed to {remote}/{target}',
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
  cardOpenGraphLabel: 'Open the commit graph by default',
  cardOpenGraphHint: 'Clicking the branch button in the composer opens the graph.',
  cardHideOfficialWorktreeLabel: 'Take over official new-worktree entry',
  cardHideOfficialWorktreeHint: 'Hide the default new-worktree control in the top-right of blank sessions and manage worktrees from this plugin instead (keeps the right-side changes & review panel).',
  cardSwitchSessionDirLabel: 'Switch worktree directory in current workspace (DSH official style)',
  cardSwitchSessionDirHint: 'Open worktrees by switching the session working directory under its repository workspace instead of creating extra sidebar workspaces. New worktrees are created lazily when the first message is sent.',
  cardManageOfficialWorktreesLabel: 'Manage official worktrees',
  cardManageOfficialWorktreesHint: 'Include worktrees under <repo>/.agents/worktrees in the worktree manager for browsing, opening, or manual removal (never touched by auto-prune).',
  cardManageWorktrees: 'Manage worktrees…',
  cardManageHint: 'Browse and remove worktrees across repositories — including directories never registered as workspaces.',
  cardFetchBeforeCreateLabel: 'Fetch upstream before creating',
  cardFetchBeforeCreateHint: 'Runs fetch --all --prune before each worktree creation. A failed sync never blocks the creation.',
  cardAutoPruneLabel: 'Auto-remove stale worktrees',
  cardAutoPruneHint: 'Over the cap, creating a worktree removes the least recently used ones (folders only — branches are kept). Uncommitted changes or a running session are never removed.',
  cardKeepWorktreesLabel: 'Worktrees to keep',
  cardKeepWorktreesHint: 'Global cap across all repositories, minimum 1.',
  cardKeepWorktreesBad: 'Enter an integer of at least 1',
  cardPostCreateCopyFilesLabel: 'Inherit configuration files (global fallback)',
  cardPostCreateCopyFilesPlaceholder: 'e.g.:\n.env\nconfig/secrets.json',
  cardPostCreateCopyFilesHint: 'One relative path per line. Only used when .worktreeinclude is absent from repository root; if present, .worktreeinclude takes precedence.',
  cardPostCreateCopyFilesBad: 'Use relative paths inside the repository; absolute paths and “..” are not allowed.',
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
  'manager.sourceOfficial': 'DSH official',
  'manager.sourceLegacy': 'legacy location',
  'manager.modeStandalone': 'Standalone workspace',
  'manager.modeSession': 'Session dir',
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
  'manager.refresh': 'Refresh',
  'manager.openSession': 'Open session in this worktree',
  'manager.openSessionOfficialHint': 'Reuse the native DSH worktree directory to continue the conversation',
  'manager.copyPath': 'Copy path',
  'manager.openFailed': 'Could not open worktree: {message}',
  'manager.scopeRepo': 'Current repository',
  'manager.showAllRepos': 'Show all repositories',
  'manager.scopeBack': 'Only {repo}',
  'manager.emptyScoped': 'No worktrees found for {repo}.',
  'contextMenu.newWorktree': 'New worktree from branch…',
  'contextMenu.checkoutPr': 'Checkout PR / MR…',
  'contextMenu.manageWorktrees': 'Manage worktrees…',
  'contextMenu.removeWorktree': 'Remove this worktree…',
  'contextMenu.removeDone': 'Worktree removed',
  menuCheckoutPr: 'Checkout PR / MR',
  'prModal.title': 'Checkout PR / MR to worktree · {repo}',
  'prModal.subtitle': 'Fetches into an isolated worktree without touching the main checkout or uncommitted changes.',
  'prModal.loading': 'Loading repository remotes…',
  'prModal.loadingRemote': 'Loading PR/MR list for {remote}…',
  'prModal.loadFailed': 'Could not load PR/MR context: {message}',
  'prModal.inputPlaceholder': 'Enter PR/MR number (e.g. 42), paste URL, or filter list…',
  'prModal.remoteLabel': 'Remote',
  'prModal.providerLabel': 'Host type',
  'prModal.providerGithub': 'GitHub PR',
  'prModal.providerGitlab': 'GitLab MR',
  'prModal.forgeUnauth': 'Code host sign-in needed for the PR list — you can still checkout by number or URL',
  'prModal.filterReviewRequested': 'Review requested ({n})',
  'prModal.filterAuthored': 'Created by me ({n})',
  'prModal.filterInvolved': 'Involved ({n})',
  'prModal.noCandidates': 'No matching PRs or MRs in this filter. You can still enter a number or URL above.',
  'prModal.tagDraft': 'Draft',
  'prModal.tagWorktree': 'Worktree exists',
  'prModal.ciSuccess': 'Checks passed',
  'prModal.ciPending': 'Checks running',
  'prModal.ciFailure': 'Checks failed',
  'prModal.resolving': 'Resolving target…',
  'prModal.previewHeading': 'Isolated worktree preview',
  'prModal.previewRef': 'Fetch ref: {ref}',
  'prModal.previewBranch': 'Local branch: {branch}',
  'prModal.previewPath': 'Worktree folder: {path}',
  'prModal.existingHeading': 'Existing worktree found for {branch}',
  'prModal.existingReuse': 'Open existing worktree (no Git writes)',
  'prModal.existingUpdate': 'Fetch latest commits and sync (clean worktree; auto-syncs remote force-push)',
  'prModal.divergedTitle': 'Local commits found on {branch}',
  'prModal.divergedDesc': 'The remote PR/MR diverged from your local commits. Open as-is to keep them, or reset to the latest PR/MR commit (discards local-only commits on this branch).',
  'prModal.divergedKeep': 'Keep local & open',
  'prModal.divergedReset': 'Reset to latest PR/MR',
  'prModal.occupiedByMain': 'Branch {branch} is currently checked out in the main repository. Switch the main checkout to another branch first.',
  'prModal.autoTrack': 'Bind this PR/MR to the session’s change request panel',
  'prModal.submitCreate': 'Checkout to worktree',
  'prModal.submitOpen': 'Open worktree',
  'prModal.submitUpdate': 'Update & open worktree',
  'prModal.stageFetch': 'Fetching PR/MR ref…',
  'prModal.stageWorktree': 'Creating isolated worktree…',
  'prModal.stageCopy': 'Copying configuration files…',
  'prModal.busy': 'Checking out…',
  'prModal.busyOpen': 'Opening…',
  'prModal.busyUpdate': 'Updating…',
  'prModal.updatedToast': 'Updated {branch} to the latest PR/MR commit',
  'prModal.forceUpdatedToast': 'Remote PR/MR was force-pushed; synced {branch} to the latest commit',
  'prModal.resetToast': 'Reset {branch} to the latest PR/MR commit',
  'prModal.upToDateToast': '{branch} is already up to date',
  'prModal.preservedLocalBranchToast': 'Existing local branch {branch} had local commits and was kept intact',
  'prModal.forkPushNote': 'Checked-out PR worktrees are intended for local review and testing; pushing depends on remote permissions.',
  'prModal.noRemotes': 'This repository has no configured Git remotes.',
  'prModal.errNoRemotes': 'This repository has no configured Git remotes.',
  'prModal.errEmptyInput': 'Enter a PR/MR number or URL.',
  'prModal.errInvalidInput': 'Enter a valid PR/MR number (e.g. 42) or a GitHub/GitLab PR/MR URL.',
  'prModal.errUnsupportedProvider': 'Unsupported code host "{provider}". Only GitHub and GitLab are supported.',
  'prModal.errUrlRepoMismatch': 'This URL points to {owner}/{repo} ({host}), which does not match any remote in this repository.',
  'prModal.errRemoteNotFound': 'Remote "{remote}" was not found in this repository.',
  'prModal.errProviderUndetected': 'Could not detect whether remote "{remote}" hosts GitHub PRs or GitLab MRs. Select a host type or paste the full URL.',
  'prModal.errWorktreeDirty': 'The PR worktree has uncommitted changes. Commit or stash them before updating.',
  'prModal.errPrRefNotFound': 'Could not find {ref} on remote "{remote}". Check the PR/MR number, remote, and host type.',
  'prModal.errPrAuthFailed': 'Authentication failed when fetching from remote "{remote}". Check your Git credentials or SSH key.',
  'forgeSlot.checkoutTooltip': 'Checkout PR/MR to isolated worktree',
  'forgeSlot.checkoutLabel': 'Checkout to worktree',
  'forgeSlot.syncTooltip': 'Sync this PR/MR worktree to latest',
  'forgeSlot.syncLabel': 'Sync PR/MR worktree',
  'sidebar.worktreeBadge': 'Git worktree · {repo}',
  'sidebar.worktreeBadgeWithBranch': 'Git worktree · {repo} ({branch})',
  'sidebar.worktreeHover': 'Worktree · {repo}',
  'sidebar.worktreeHoverWithBranch': 'Worktree · {repo} / {branch}',
  'sidebar.worktreeHoverLabel': 'Worktree',
  'sidebar.worktreeHoverFrom': 'Worktree · from {base}',
  'sidebar.worktreeHoverPr': 'Worktree · {label}',
  'createModal.title': 'New worktree · {repo}',
  'createModal.loading': 'Loading branches…',
  'createModal.loadFailed': 'Could not load branches: {message}',
  'createModal.searchPlaceholder': 'Search existing branches',
  'createModal.cutFromBranch': 'New branch and worktree from {base}…',
  'createModal.noMatches': 'No matching branches',
  'createModal.tagCurrent': 'current',
  'createModal.tagWorktree': 'worktree',
  'createModal.tagRemote': 'remote',
  'createModal.creating': 'Creating worktree…',
  'deferred.armedTitle': 'Will create a worktree when you send the first message',
  'deferred.armedRandom': 'Random branch from {base}',
  'deferred.armedCutout': 'New branch {name} from {base}',
  'deferred.armedBranch': 'Branch {branch}',
  'deferred.armedPr': 'PR / MR · {branch}',
  'deferred.armedCancel': 'Cancel',
  'deferred.runningTitle': 'Creating worktree',
  'deferred.failedTitle': 'Failed to create worktree',
  'deferred.phaseFetch': 'Syncing upstream remotes',
  'deferred.phaseCreate': 'Creating branch and worktree',
  'deferred.phaseCopy': 'Copying configuration files',
  'deferred.phaseSwitch': 'Switching session directory',
  'deferred.labelBranch': 'Branch',
  'deferred.labelBase': 'Base',
  'deferred.labelReason': 'Reason',
  'deferred.waitingNote': 'Your message will be sent once the worktree is ready',
  'deferred.retry': 'Retry',
  'deferred.withdraw': 'Continue without worktree',
  fetchWarning: 'Upstream sync failed; created from the local state: {message}',
  excludeWarning: 'The ignore rule for the repository could not be written; `.dsh/` will show as untracked: {message}',
  copyWarning: 'Some configuration files could not be copied: {message}',
  gitFailSwitchDirty: 'Uncommitted changes would be overwritten by switching branches. Commit or stash them, then try again.',
  gitFailSwitchMissing: 'That branch no longer exists. Refresh the list and try again.',
  gitFailDeleteUnmerged: 'Branch {branch} is not fully merged yet and was not deleted.',
  gitFailDeleteCheckedOut: 'Branch {branch} is currently checked out and cannot be deleted.',
  gitFailWorktreeOccupied: 'Branch {branch} is already checked out in another worktree.',
  gitFailWorktreePathExists: 'The target worktree directory already exists and is not empty.',
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
  'worktreeRemove.sessions.one': '{n} session associated with this worktree will be archived too.',
  'worktreeRemove.sessions.other': '{n} sessions associated with this worktree will be archived too.',
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
  graphTitle: '提交图谱',
  graphDetail: '提交详情',
  graphNoBody: '此提交没有正文',
  graphExpandBody: '展开正文',
  graphCollapseBody: '收起正文',
  graphNoFiles: '无文件变更',
  graphFiles: '{count} 个文件',
  graphBinary: '{count} 个二进制文件',
  graphRefresh: '刷新提交历史',
  graphCloseWindow: '关闭弹出的窗',
  graphToggleOpen: '打开图谱',
  graphToggleClose: '关闭图谱',
  graphShowBranches: '显示分支列表',
  graphHideBranches: '收起分支列表',
  graphSearch: '搜索',
  graphSearchPlaceholder: '文本或哈希',
  graphAuthorFilter: '作者筛选',
  graphAllAuthors: '全部作者',
  graphColumn: '图谱',
  graphCommit: '提交',
  graphAuthor: '作者',
  graphDate: '日期',
  graphCommits: '提交历史',
  graphNoMatches: '没有匹配的提交',
  graphEmpty: '此分支暂无提交',
  graphLoading: '正在读取提交…',
  graphLoaded: '已加载 {count} 条提交',
  graphRetry: '重试',
  graphMore: '加载更多',
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
  cutoutNewBranchPlaceholder: '新分支名（留空随机生成）',
  menuNewBranchBad: 'Git 不接受该名称',
  menuNewBranchExists: '同名分支已存在',
  menuFetch: '提取',
  menuUpdate: '更新',
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
  updateFailDiverged: '分支已分叉，请先合并或变基上游。',
  updateFailDirty: '工作区有未提交的改动，快进会覆盖它们。请先提交或暂存这些改动，再更新。',
  updateFailNoUpstream: '当前分支没有可用的上游，无法更新。请先推送并设置上游。',
  fetchFailRemotePathMissing: '远程仓库{remote}的地址指向的目录已不存在或不是 Git 仓库：{path}。请把它指向有效地址（git remote set-url {remote} <地址>），或让它不再参与批量抓取（git config remote.{remote}.skipFetchAll true）。',
  fetchFailRemoteNotFound: '远程仓库{remote}在 {url} 上不存在。请检查地址，或确认你仍有访问权限。',
  fetchFailRemoteAuthFailed: '远程仓库{remote}拒绝了连接：认证失败。请检查凭据或 SSH 私钥。',
  fetchFailRemoteUnreachable: '远程仓库{remote}无法访问：{url}。请检查网络与地址。',
  fetchFailRemoteUnknown: '远程仓库{remote}抓取失败。',
  fetchFailRemoteUnnamed: '',
  syncTitleFetch: '正在提取远程分支',
  syncTitleUpdate: '正在更新 {branch}',
  syncTitlePush: '正在推送 {branch}',
  syncConnecting: '正在连接远程…',
  syncMerging: '正在快进 {branch}…',
  syncCancel: '取消',
  fetchCancelled: '已取消提取',
  updateCancelled: '已取消更新',
  pushCancelled: '已取消推送',
  'aheadTitle.one': '领先上游 {n} 个提交',
  'aheadTitle.other': '领先上游 {n} 个提交',
  'behindTitle.one': '落后上游 {n} 个提交',
  'behindTitle.other': '落后上游 {n} 个提交',
  unpublishedTitle: '尚未推送：未配置上游分支',
  upstreamGoneTitle: '上游 {upstream} 已失效，请重新选择推送目标',
  ctxPush: '推送',
  pushTitle: '推送',
  pushEditTarget: '修改目标分支',
  pushEditTargetClose: '关闭且不应用',
  pushApplyEnter: '按 Enter 应用',
  pushNew: '新建',
  pushEmpty: '没有待推送的提交',
  pushNewEmpty: '将在远程新建此分支',
  'pushCommitCount.one': '{n} 个提交',
  'pushCommitCount.other': '{n} 个提交',
  pushFailBehind: '远程分支有本地没有的提交。请先更新该分支，或使用“强制推送”覆盖它们。',
  pushFailStale: '预览之后远程分支又有更新，预览已刷新。请确认后重新推送。',
  pushFailHook: '本地的 pre-push 钩子拒绝了这次推送。详情见下方。',
  pushFailRefused: '远程拒绝了本次更新（例如受保护分支或服务端钩子）。详情见下方。',
  pushFailAuth: '认证失败。请检查 Git 凭据或 SSH 密钥；插件无法弹出密码输入。',
  pushCommitList: '待推送提交列表',
  pushTruncated: '仅显示前 {n} 条提交',
  pushTags: '推送标记',
  pushTagsAll: '所有',
  pushTagsFollow: '跟随提交',
  pushTagsAllHint: '推送所有本地 Git 标记，包括与当前分支无关的标记',
  pushTagsFollowHint: '仅推送远程缺少、且指向本次推送提交历史的附注标记，不含轻量标记',
  pushForce: '强制推送',
  pushForceHint: '使用 force-with-lease；远程在预览后有更新时拒绝覆盖',
  pushOptions: '推送选项',
  pushRefresh: '刷新推送预览',
  pushBranch: '远程分支名称',
  pushPlanning: '正在读取本地提交…',
  pushCheckingRemote: '正在校验远程目标…',
  pushLocalChecking: '本地预览 · 正在校验远程…',
  pushLocalUnverified: '本地预览 · 远程尚未校验',
  pushLocalEmpty: '本地预览暂无待推送提交',
  pushReadingCommits: '正在读取提交消息…',
  pushBusy: '正在推送…',
  pushDone: '已将 {branch} 推送到 {remote}/{target}',
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
  cardOpenGraphLabel: '默认展开 Git 图谱',
  cardOpenGraphHint: '点击对话框里的分支图标时直接打开提交图谱。',
  cardHideOfficialWorktreeLabel: '接管官方新建工作树入口',
  cardHideOfficialWorktreeHint: '隐藏空白会话右上角默认的新建工作树按钮，统一由左下角分支菜单管理（不影响右侧变更与评审面板）。',
  cardSwitchSessionDirLabel: '在当前工作区下切换工作树目录（同 DSH 官方方式）',
  cardSwitchSessionDirHint: '新建或打开工作树时不再新增侧边栏工作区，直接在所属仓库下切换会话工作目录；新建工作树将在发送首条消息时延迟创建（已有独立工作区不受影响）。',
  cardManageOfficialWorktreesLabel: '管理官方创建的工作树',
  cardManageOfficialWorktreesHint: '在工作树管理弹窗中一并扫描并管理 <repo>/.agents/worktrees 下的官方工作树（仅支持查看、打开与手动删除，不参与自动清理）。',
  cardManageWorktrees: '管理工作树…',
  cardManageHint: '跨仓库查看并删除全部工作树，包含从未注册为工作区的目录。',
  cardFetchBeforeCreateLabel: '创建工作树前同步上游',
  cardFetchBeforeCreateHint: '每次创建工作树前先执行 fetch --all --prune 同步远程引用；同步失败不会阻断创建。',
  cardAutoPruneLabel: '自动删除旧工作树',
  cardAutoPruneHint: '超出保留数量时，新建工作树后自动删除最久未用的（只删目录，保留分支）。有未提交改动或进行中会话的不会被删。',
  cardKeepWorktreesLabel: '保留工作树数量',
  cardKeepWorktreesHint: '所有仓库合计的全局上限，最小为 1。',
  cardKeepWorktreesBad: '请输入不小于 1 的整数',
  cardPostCreateCopyFilesLabel: '新建工作树配置文件继承（全局后备）',
  cardPostCreateCopyFilesPlaceholder: '例如：\n.env\nconfig/secrets.json',
  cardPostCreateCopyFilesHint: '每行一个相对路径。仅在仓库根目录不存在 .worktreeinclude 时生效；若仓库存在 .worktreeinclude，则优先使用该文件。',
  cardPostCreateCopyFilesBad: '请仅填写仓库内的相对路径，不允许绝对路径或包含“..”。',
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
  'manager.sourceOfficial': 'DSH 官方',
  'manager.sourceLegacy': '历史位置',
  'manager.modeStandalone': '独立工作区',
  'manager.modeSession': '会话目录',
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
  'manager.refresh': '刷新',
  'manager.openSession': '在此工作树中打开会话',
  'manager.openSessionOfficialHint': '复用 DSH 原生工作树目录继续对话',
  'manager.copyPath': '复制路径',
  'manager.openFailed': '无法打开工作树：{message}',
  'manager.scopeRepo': '当前仓库',
  'manager.showAllRepos': '显示全部仓库',
  'manager.scopeBack': '仅看 {repo}',
  'manager.emptyScoped': '当前仓库 {repo} 暂无工作树。',
  'contextMenu.newWorktree': '从分支新建工作树…',
  'contextMenu.checkoutPr': '检出 PR / MR…',
  'contextMenu.manageWorktrees': '管理工作树…',
  'contextMenu.removeWorktree': '删除此工作树…',
  'contextMenu.removeDone': '已删除工作树',
  menuCheckoutPr: '检出 PR / MR',
  'prModal.title': '检出 PR / MR 到隔离工作树 · {repo}',
  'prModal.subtitle': '拉取到独立工作树分支，不改动主仓库当前分支与未提交修改。',
  'prModal.loading': '正在读取仓库远程信息…',
  'prModal.loadingRemote': '正在加载 {remote} 的候选列表…',
  'prModal.loadFailed': '加载 PR / MR 上下文失败：{message}',
  'prModal.inputPlaceholder': '输入 PR / MR 编号（如 42）、粘贴链接或筛选列表…',
  'prModal.remoteLabel': 'Remote',
  'prModal.providerLabel': '平台类型',
  'prModal.providerGithub': 'GitHub PR',
  'prModal.providerGitlab': 'GitLab MR',
  'prModal.forgeUnauth': '代码托管平台未登录（暂不展示候选列表）— 仍可直接输入编号或链接检出',
  'prModal.filterReviewRequested': '待我评审 ({n})',
  'prModal.filterAuthored': '我创建的 ({n})',
  'prModal.filterInvolved': '与我有关 ({n})',
  'prModal.noCandidates': '当前筛选下没有匹配的 PR / MR，仍可直接在上方输入编号或链接检出。',
  'prModal.tagDraft': '草稿',
  'prModal.tagWorktree': '已有工作树',
  'prModal.ciSuccess': '检查通过',
  'prModal.ciPending': '检查进行中',
  'prModal.ciFailure': '检查失败',
  'prModal.resolving': '正在解析目标…',
  'prModal.previewHeading': '隔离工作树落盘预览',
  'prModal.previewRef': '拉取引用：{ref}',
  'prModal.previewBranch': '本地分支：{branch}',
  'prModal.previewPath': '工作树目录：{path}',
  'prModal.existingHeading': '检测到 {branch} 已有本地工作树',
  'prModal.existingReuse': '直接打开已有工作树（零 Git 写入）',
  'prModal.existingUpdate': '拉取最新提交并同步更新（仅干净工作树；远端强制推送时自动同步）',
  'prModal.divergedTitle': '分支 {branch} 包含未合并的本地提交',
  'prModal.divergedDesc': '远端 PR / MR 与你的本地提交已分叉。可直接打开以保留本地提交，或重置到 PR / MR 最新提交（将丢弃该分支上的本地提交）。',
  'prModal.divergedKeep': '保留本地直接打开',
  'prModal.divergedReset': '重置到 PR / MR 最新',
  'prModal.occupiedByMain': '主仓库当前正检出分支 {branch}，请先在主仓库切换其他分支后再检出此 PR / MR。',
  'prModal.autoTrack': '检出后自动关联到会话的变更请求面板',
  'prModal.submitCreate': '检出并进入工作树',
  'prModal.submitOpen': '打开已有工作树',
  'prModal.submitUpdate': '更新并打开工作树',
  'prModal.stageFetch': '正在拉取 PR / MR 引用…',
  'prModal.stageWorktree': '正在创建隔离工作树…',
  'prModal.stageCopy': '正在复制配置文件…',
  'prModal.busy': '正在检出…',
  'prModal.busyOpen': '正在打开…',
  'prModal.busyUpdate': '正在更新…',
  'prModal.updatedToast': '已将 {branch} 更新到最新提交',
  'prModal.forceUpdatedToast': '远端 PR / MR 已强制更新，已将 {branch} 同步到最新提交',
  'prModal.resetToast': '已将 {branch} 重置到 PR / MR 最新提交',
  'prModal.upToDateToast': '{branch} 已是最新提交',
  'prModal.preservedLocalBranchToast': '本地分支 {branch} 包含未合并的本地提交，已原样保留',
  'prModal.forkPushNote': '检出的 PR 工作树主要用于本地审阅与测试；直接推送受远端权限限制。',
  'prModal.noRemotes': '当前仓库尚未配置任何 Git Remote。',
  'prModal.errNoRemotes': '当前仓库尚未配置任何 Git Remote。',
  'prModal.errEmptyInput': '请输入 PR / MR 编号或完整链接。',
  'prModal.errInvalidInput': '请输入有效的 PR / MR 编号（如 42）或 GitHub / GitLab PR / MR 链接。',
  'prModal.errUnsupportedProvider': '暂不支持代码托管平台“{provider}”，目前仅支持 GitHub 与 GitLab。',
  'prModal.errUrlRepoMismatch': '该链接指向 {owner}/{repo}（{host}），与当前仓库配置的任何 Remote 均不匹配。',
  'prModal.errRemoteNotFound': '当前仓库未找到名为“{remote}”的 Remote。',
  'prModal.errProviderUndetected': '无法自动判断 Remote“{remote}”属于 GitHub 还是 GitLab，请手动选择平台类型或粘贴完整链接。',
  'prModal.errWorktreeDirty': '该 PR 工作树存在未提交改动，请先提交或暂存后再更新。',
  'prModal.errPrRefNotFound': '在 Remote“{remote}”上未找到引用 {ref}，请确认 PR / MR 编号、Remote 和平台类型是否正确。',
  'prModal.errPrAuthFailed': '从 Remote“{remote}”拉取失败：认证未通过。请检查 Git 凭据或 SSH 密钥配置。',
  'forgeSlot.checkoutTooltip': '检出 PR / MR 到隔离工作树',
  'forgeSlot.checkoutLabel': '检出到工作树',
  'forgeSlot.syncTooltip': '同步此 PR / MR 工作树到最新',
  'forgeSlot.syncLabel': '同步 PR / MR 工作树',
  'sidebar.worktreeBadge': 'Git 工作树 · {repo}',
  'sidebar.worktreeBadgeWithBranch': 'Git 工作树 · {repo}（{branch}）',
  'sidebar.worktreeHover': '工作树 · {repo}',
  'sidebar.worktreeHoverWithBranch': '工作树 · {repo} / {branch}',
  'sidebar.worktreeHoverLabel': '工作树',
  'sidebar.worktreeHoverFrom': '工作树 · 基于 {base}',
  'sidebar.worktreeHoverPr': '工作树 · {label}',
  'createModal.title': '新建工作树 · {repo}',
  'createModal.loading': '正在加载分支…',
  'createModal.loadFailed': '分支加载失败：{message}',
  'createModal.searchPlaceholder': '搜索已有分支',
  'createModal.cutFromBranch': '从 {base} 新建分支并创建工作树…',
  'createModal.noMatches': '没有匹配的分支',
  'createModal.tagCurrent': '当前',
  'createModal.tagWorktree': '已有工作树',
  'createModal.tagRemote': '远程',
  'createModal.creating': '正在创建工作树…',
  'deferred.armedTitle': '将在发送首条消息时创建工作树',
  'deferred.armedRandom': '基于 {base} 随机生成分支',
  'deferred.armedCutout': '基于 {base} 新建分支 {name}',
  'deferred.armedBranch': '分支 {branch}',
  'deferred.armedPr': 'PR / MR · {branch}',
  'deferred.armedCancel': '取消',
  'deferred.runningTitle': '正在创建工作树',
  'deferred.failedTitle': '创建工作树失败',
  'deferred.phaseFetch': '同步上游远程分支',
  'deferred.phaseCreate': '创建分支与工作树',
  'deferred.phaseCopy': '复制配置文件',
  'deferred.phaseSwitch': '切换会话工作目录',
  'deferred.labelBranch': '分支',
  'deferred.labelBase': '基于',
  'deferred.labelReason': '原因',
  'deferred.waitingNote': '消息会在工作树建好后发送',
  'deferred.retry': '重试',
  'deferred.withdraw': '不使用工作树',
  fetchWarning: '上游同步失败，已按本地状态创建：{message}',
  excludeWarning: '仓库忽略规则写入失败，`.dsh/` 将显示为未跟踪目录：{message}',
  copyWarning: '部分配置文件未能复制到新工作树：{message}',
  gitFailSwitchDirty: '工作区有未提交的改动，切换分支会覆盖它们。请先提交或暂存后再试。',
  gitFailSwitchMissing: '目标分支已不存在，请刷新分支列表后重试。',
  gitFailDeleteUnmerged: '分支 {branch} 尚未完全合并，已拒绝安全删除。',
  gitFailDeleteCheckedOut: '分支 {branch} 正在被当前或其他工作树检出，无法删除。',
  gitFailWorktreeOccupied: '分支 {branch} 已被其他工作树占用，请直接跳转到该工作树或切出新分支。',
  gitFailWorktreePathExists: '目标工作树目录已存在且非空，请清理后重试。',
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
  'worktreeRemove.sessions.one': '此工作树关联的 {n} 个会话将一并归档。',
  'worktreeRemove.sessions.other': '此工作树关联的 {n} 个会话将一并归档。',
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
