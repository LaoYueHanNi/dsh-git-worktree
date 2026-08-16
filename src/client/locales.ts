/**
 * Locale dictionaries for the git-worktree plugin. zh is the key source; en
 * is `Record<GitWorktreeKey, string>`, so a missing translation fails the
 * build instead of surfacing a raw key.
 */

/** Every copy key the plugin surfaces (chip, dialogs, settings section). */
export type GitWorktreeKey =
  | 'chipWorktree'
  | 'worktreeToggle'
  | 'menuLocalBranches'
  | 'switchAsk'
  | 'switchBusy'
  | 'worktreeAskNew'
  | 'worktreeAskReuse'
  | 'worktreeBusy'
  | 'actionCancel'
  | 'actionConfirm'
  | 'errorGeneric'
  | 'settingsNav'
  | 'settingsTitle'
  | 'settingsDescription'
  | 'settingsRootDir'
  | 'settingsBrowse'
  | 'settingsRootDirHelp'
  | 'settingsRootDirInvalid'
  | 'settingsSaving'
  | 'settingsSaved'

/** English dictionary — complete by construction. */
export const en: Record<GitWorktreeKey, string> = {
  chipWorktree: 'Worktree',
  worktreeToggle: 'Create an isolated worktree',
  menuLocalBranches: 'Local branches',
  switchAsk: 'Switch to {branch}?',
  switchBusy: 'Switching…',
  worktreeAskNew: 'Create a worktree from {branch}?',
  worktreeAskReuse: 'Switch to the {branch} worktree?',
  worktreeBusy: 'Creating…',
  actionCancel: 'Cancel',
  actionConfirm: 'Confirm',
  errorGeneric: 'Git worktree: {message}',
  settingsNav: 'Git Worktree',
  settingsTitle: 'Git worktree',
  settingsDescription: 'Where isolated worktree folders for new sessions are stored.',
  settingsRootDir: 'Worktree storage folder',
  settingsBrowse: 'Browse…',
  settingsRootDirHelp: 'Absolute path. Empty uses the default ~/.dsh/gitworktree.',
  settingsRootDirInvalid: 'Enter an absolute path, or leave it empty for the default.',
  settingsSaving: 'Saving…',
  settingsSaved: 'Saved',
}

/** 中文词典。 */
export const zh: Record<GitWorktreeKey, string> = {
  chipWorktree: '工作树',
  worktreeToggle: '创建隔离工作树',
  menuLocalBranches: '本地分支',
  switchAsk: '是否切到 {branch}？',
  switchBusy: '切换中…',
  worktreeAskNew: '是否从 {branch} 新建工作树？',
  worktreeAskReuse: '是否切到 {branch} 工作树？',
  worktreeBusy: '创建中…',
  actionCancel: '取消',
  actionConfirm: '确认',
  errorGeneric: 'Git 工作树：{message}',
  settingsNav: 'Git 工作树',
  settingsTitle: 'Git 工作树',
  settingsDescription: '新会话的隔离工作树文件夹存放位置。',
  settingsRootDir: '工作树存放目录',
  settingsBrowse: '浏览…',
  settingsRootDirHelp: '绝对路径。留空使用默认 ~/.dsh/gitworktree。',
  settingsRootDirInvalid: '请输入绝对路径，或留空使用默认位置。',
  settingsSaving: '保存中…',
  settingsSaved: '已保存',
}
