import { describe, expect, it } from 'vitest'
import { explainFetchFailure } from '../src/client/fetch-error.ts'

/** The failure the live fetch produces when a remote's address is a folder
 * that was moved out from under it. */
const movedFolder = [
  'git fetch --all --prune failed (exit 128): remote "upstream" (url: C:\\Users\\OYW\\Documents\\MyCode\\cc-switch)',
  "fatal: 'C:\\Users\\OYW\\Documents\\MyCode\\cc-switch' does not appear to be a git repository",
  'fatal: Could not read from remote repository. Please make sure you have the correct access rights',
  'and the repository exists.',
].join('\n')

describe('explainFetchFailure', () => {
  it('names the remote, its address and the folder that is gone', () => {
    expect(explainFetchFailure(movedFolder)).toEqual({
      kind: 'remotePathMissing',
      remote: 'upstream',
      url: 'C:\\Users\\OYW\\Documents\\MyCode\\cc-switch',
      path: 'C:\\Users\\OYW\\Documents\\MyCode\\cc-switch',
    })
  })

  it('recognises the same failure without the remote head', () => {
    const failure = explainFetchFailure([
      "fatal: 'C:\\Users\\OYW\\Documents\\MyCode\\cc-switch' does not appear to be a git repository",
      'fatal: Could not read from remote repository.',
    ].join('\n'))
    expect(failure?.kind).toBe('remotePathMissing')
    expect(failure?.remote).toBeNull()
    expect(failure?.path).toBe('C:\\Users\\OYW\\Documents\\MyCode\\cc-switch')
  })

  it.each([
    ['remoteAuthFailed', [
      'remote "origin" (url: git@github.com:LaoYueHanNi/cc-switch.git)',
      'Permission denied (publickey).',
      'fatal: Could not read from remote repository. Please make sure you have the correct access rights and the repository exists.',
    ].join('\n')],
    ['remoteNotFound', [
      'remote "origin" (url: git@github.com:no/such-repo.git)',
      'ERROR: Repository not found.',
      "fatal: Repository 'git@github.com:no/such-repo.git' not found",
    ].join('\n')],
    ['remoteUnreachable', [
      'remote "origin" (url: git@github.com:LaoYueHanNi/cc-switch.git)',
      'ssh: Could not resolve hostname github.com: Name or service not known',
      'fatal: Could not read from remote repository.',
    ].join('\n')],
    ['remoteUnknown', [
      'remote "origin" (url: git@github.com:LaoYueHanNi/cc-switch.git)',
      'fatal: Could not read from remote repository.',
    ].join('\n')],
  ] as const)('recognises %s', (kind, raw) => {
    expect(explainFetchFailure(raw)?.kind).toBe(kind)
  })

  it('falls back to the plain words when the address is unknown', () => {
    // The reason names a repository that is not there, but nothing says
    // which address it was — a sentence with an empty address helps nobody.
    const failure = explainFetchFailure([
      'remote: Repository not found.',
      "fatal: repository 'https://github.com/no/such-repo/' not found",
    ].join('\n'))
    expect(failure?.kind).toBe('remoteUnknown')
    expect(failure?.url).toBeNull()
  })

  it('returns null for a failure that is not a fetch', () => {
    expect(explainFetchFailure('fatal: Not possible to fast-forward, aborting.')).toBeNull()
    expect(explainFetchFailure('fatal: early EOF')).toBeNull()
    expect(explainFetchFailure('')).toBeNull()
  })
})
