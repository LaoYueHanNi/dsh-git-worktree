import { describe, expect, it } from 'vitest'
import { createProgressReader, stripProgress, type GitProgress } from '../src/progress.ts'

/** A reader whose clock only moves when the test says so. */
function harness(intervalMs = 150) {
  const events: GitProgress[] = []
  let clock = 0
  const reader = createProgressReader(event => { events.push(event) }, { intervalMs, now: () => clock })
  return { reader, events, advance: (ms: number) => { clock += ms } }
}

describe('createProgressReader', () => {
  it('reads a carriage-return redraw and a finished line with git’s own text and percent', () => {
    const { reader, events } = harness()
    reader.feed('Receiving objects:   3% (2147/58680), 708.01 KiB | 128.00 KiB/s\r')
    reader.feed('Receiving objects: 100% (58680/58680), 12.00 MiB | 1.00 MiB/s, done.\n')
    reader.end()
    expect(events[0]).toEqual({ text: 'Receiving objects:   3% (2147/58680), 708.01 KiB | 128.00 KiB/s', percent: 3 })
    expect(events.at(-1)).toEqual({ text: 'Receiving objects: 100% (58680/58680), 12.00 MiB | 1.00 MiB/s, done.', percent: 100 })
  })

  it('keeps a line that straddles two chunks whole', () => {
    const { reader, events } = harness()
    reader.feed('Resolving deltas:  4')
    reader.feed('2% (21/50)\r')
    expect(events).toEqual([{ text: 'Resolving deltas:  42% (21/50)', percent: 42 }])
  })

  it('strips terminal control sequences and the remote: prefix still counts as progress', () => {
    const { reader, events } = harness()
    reader.feed('remote: Compressing objects:  50% (5/10)\u001b[K\r')
    expect(events).toEqual([{ text: 'remote: Compressing objects:  50% (5/10)', percent: 50 }])
  })

  it('ignores lines that are not progress', () => {
    const { reader, events } = harness()
    reader.feed('remote: Enumerating objects: 5, done.\n')
    reader.feed('From E:/repos/origin\n')
    reader.feed(' * [new branch]      feature/x  -> origin/feature/x\n')
    reader.feed(' - [deleted]         (none)     -> origin/gone\n')
    reader.end()
    expect(events).toEqual([])
  })

  it('does not take a percentage inside a ref name or a porcelain line for progress', () => {
    const { reader, events } = harness(0)
    reader.feed(' * [new branch]      feat/50%-done -> origin/feat/50%-done\n')
    reader.feed('*\trefs/heads/feat/50%-done:refs/heads/feat/50%-done\t[new branch]\n')
    reader.feed('remote: Resolve 100% of the conflicts by hand\n')
    reader.end()
    expect(events).toEqual([])
    // …while the real counters of a push read like a fetch's.
    reader.feed('Writing objects:  42% (21/50), 3.00 MiB | 1.50 MiB/s\r')
    expect(events).toEqual([{ text: 'Writing objects:  42% (21/50), 3.00 MiB | 1.50 MiB/s', percent: 42 }])
  })

  it('says which remote is next, tags what follows with it, and follows a switch', () => {
    const { reader, events } = harness(0)
    reader.remote('origin')
    reader.feed('Receiving objects:  10% (1/10)\r')
    reader.remote('fork')
    reader.feed('Receiving objects:  20% (2/10)\r')
    expect(events).toEqual([
      { text: 'Fetching origin', remote: 'origin' },
      { text: 'Receiving objects:  10% (1/10)', percent: 10, remote: 'origin' },
      { text: 'Fetching fork', remote: 'fork' },
      { text: 'Receiving objects:  20% (2/10)', percent: 20, remote: 'fork' },
    ])
  })

  it('finishes the previous remote’s held word under its own name before the next remote starts', () => {
    const { reader, events, advance } = harness(150)
    reader.remote('origin')
    reader.feed('Receiving objects:  10% (1/10)\r')
    advance(10)
    reader.feed('Receiving objects: 100% (10/10), done.')
    // Held back by the throttle, and the line has no terminator yet.
    expect(events.map(event => event.percent)).toEqual([undefined, 10])
    advance(10)
    reader.remote('fork')
    // A same-named phase of the new remote is not mistaken for a repeat.
    reader.feed('Receiving objects:   5% (1/20)\r')
    expect(events.map(event => [event.remote, event.percent])).toEqual([
      ['origin', undefined],
      ['origin', 10],
      ['origin', 100],
      ['fork', undefined],
      ['fork', 5],
    ])
  })

  it('throttles redraws of one phase, always shows a new phase, and flushes the newest on end', () => {
    const { reader, events, advance } = harness(150)
    reader.feed('Receiving objects:   1% (1/100)\r')
    advance(10)
    reader.feed('Receiving objects:   2% (2/100)\r')
    advance(10)
    reader.feed('Receiving objects:   3% (3/100)\r')
    expect(events.map(event => event.percent)).toEqual([1])
    advance(200)
    reader.feed('Receiving objects:   4% (4/100)\r')
    expect(events.map(event => event.percent)).toEqual([1, 4])
    advance(1)
    reader.feed('Resolving deltas:   0% (0/9)\r')
    expect(events.map(event => event.percent)).toEqual([1, 4, 0])
    advance(1)
    reader.feed('Resolving deltas:  50% (5/9)\r')
    reader.end()
    expect(events.map(event => event.percent)).toEqual([1, 4, 0, 50])
  })

  it('reads a last line that never got its terminator when the stream ends', () => {
    const { reader, events } = harness()
    reader.feed('Receiving objects:  77% (7/9)')
    expect(events).toEqual([])
    reader.end()
    expect(events).toEqual([{ text: 'Receiving objects:  77% (7/9)', percent: 77 }])
  })

  it('treats CRLF as one break and clamps an out-of-range percent', () => {
    const { reader, events } = harness(0)
    reader.feed('Counting objects: 100% (3/3)\r\nCounting objects: 999% (3/3)\r\n')
    expect(events.map(event => event.percent)).toEqual([100, 100])
  })
})

describe('stripProgress', () => {
  it('drops counted progress redraws and keeps the failure and the context around it', () => {
    const stderr = [
      'Fetching origin',
      'remote: Enumerating objects: 5, done.',
      'Receiving objects:   3% (2/60), 100.00 KiB | 50.00 KiB/s\rReceiving objects:  60% (36/60), 1.00 MiB | 1.00 MiB/s\r',
      'Receiving objects: 100% (60/60), 2.00 MiB | 1.00 MiB/s, done.',
      'fatal: unable to access \'https://example.invalid/r.git/\': Could not resolve host',
      '',
    ].join('\n')
    expect(stripProgress(stderr)).toBe([
      'Fetching origin',
      'fatal: unable to access \'https://example.invalid/r.git/\': Could not resolve host',
    ].join('\n'))
  })

  it('drops the chatter --progress adds to a push, so the remote’s own reason is the first thing left', () => {
    const stderr = [
      'Enumerating objects: 204, done.',
      'Counting objects: 100% (204/204), done.',
      'Delta compression using up to 20 threads',
      'Compressing objects: 100% (202/202), done.',
      'Writing objects: 100% (203/203), 8.01 MiB | 1.00 MiB/s, done.',
      'Total 203 (delta 1), reused 0 (delta 0), pack-reused 0 (from 0)',
      'remote: protected branch policy: pushes to refs/heads/main are not allowed here',
      'To /srv/origin.git',
      ' ! [remote rejected] main -> main (pre-receive hook declined)',
      'error: failed to push some refs to \'/srv/origin.git\'',
    ].join('\n')
    expect(stripProgress(stderr).split('\n')[0]).toBe('remote: protected branch policy: pushes to refs/heads/main are not allowed here')
    expect(stripProgress(stderr).split('\n')).toHaveLength(4)
  })

  it('keeps a line that only looks like chatter: a remote message with its own count, or a hint', () => {
    const kept = [
      'remote: Total of 3 files failed the policy check',
      'remote: Counting objects: the server refused (quota)',
      'hint: Updates were rejected because the tip of your current branch is behind',
    ].join('\n')
    expect(stripProgress(kept)).toBe(kept)
  })

  it('returns an empty string for pure progress', () => {
    expect(stripProgress('Resolving deltas: 100% (9/9), done.\n')).toBe('')
  })
})
