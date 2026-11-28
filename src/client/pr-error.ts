/**
 * Localized client presentation for PR/MR route errors keyed by `PrErrorCode`.
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PrErrorCode } from '../wire.ts'

type Translate = PropsLocale<'git-worktree'>['t']

const KNOWN_PR_ERROR_CODES: ReadonlySet<string> = new Set<PrErrorCode>([
  'no_remotes',
  'empty_input',
  'invalid_input',
  'unsupported_provider',
  'url_repo_mismatch',
  'remote_not_found',
  'provider_undetected',
  'occupied_by_main',
  'worktree_dirty',
  'worktree_diverged',
  'pr_ref_not_found',
  'pr_auth_failed',
  'pr_timeout',
  'pr_network_failed',
])

function isPrErrorCode(code: string | undefined): code is PrErrorCode {
  return code !== undefined && KNOWN_PR_ERROR_CODES.has(code)
}

function translateKnownPrError(
  code: PrErrorCode,
  params: Record<string, string | number> | undefined,
  t: Translate,
): string {
  switch (code) {
    case 'no_remotes':
      return t('prModal.errNoRemotes')
    case 'empty_input':
      return t('prModal.errEmptyInput')
    case 'invalid_input':
      return t('prModal.errInvalidInput')
    case 'unsupported_provider':
      return t('prModal.errUnsupportedProvider', { provider: String(params?.provider ?? '') })
    case 'url_repo_mismatch':
      return t('prModal.errUrlRepoMismatch', {
        owner: String(params?.owner ?? ''),
        repo: String(params?.repo ?? ''),
        host: String(params?.host ?? ''),
      })
    case 'remote_not_found':
      return t('prModal.errRemoteNotFound', { remote: String(params?.remote ?? '') })
    case 'provider_undetected':
      return t('prModal.errProviderUndetected', { remote: String(params?.remote ?? '') })
    case 'occupied_by_main':
      return t('prModal.occupiedByMain', { branch: String(params?.branch ?? '') })
    case 'worktree_dirty':
      return t('prModal.errWorktreeDirty')
    case 'worktree_diverged':
      return t('prModal.divergedTitle', { branch: String(params?.branch ?? '') })
    case 'pr_ref_not_found':
      return t('prModal.errPrRefNotFound', {
        ref: String(params?.ref ?? ''),
        remote: String(params?.remote ?? ''),
      })
    case 'pr_auth_failed':
      return t('prModal.errPrAuthFailed', { remote: String(params?.remote ?? '') })
    case 'pr_timeout':
      return t('prModal.errPrTimeout', { remote: String(params?.remote ?? '') })
    case 'pr_network_failed':
      return t('prModal.errPrNetworkFailed', { remote: String(params?.remote ?? '') })
  }
  const exhaustive: never = code
  return exhaustive
}

/** Translate a structured PR/MR route failure into localized copy, falling back to the raw error message. */
export function formatPrError(
  error: string,
  code: string | undefined,
  params: Record<string, string | number> | undefined,
  t: Translate,
): string {
  if (!isPrErrorCode(code)) return error
  return translateKnownPrError(code, params, t)
}
