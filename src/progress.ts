/**
 * Reader for git's progress output, the host half of the live fetch/update
 * feedback.
 *
 * `git fetch <remote> --progress` writes one line per observation to stderr,
 * ended by `\r` while a phase is still counting and by `\n` once it is done:
 *
 *     remote: Compressing objects:  50% (101/202)\r
 *     Receiving objects:   3% (2147/58680), 708.01 KiB | 128.00 KiB/s\r
 *
 * (`fetch --all` over several remotes would not do: git starts a child per
 * remote that never gets `--progress`, so the caller fetches them one by one
 * and names each through {@link ProgressReader.remote}.)
 *
 * This turns that stream into structured, throttled events and nothing else:
 * no localisation (the line is git's own words, shown as is, like IDEA's task
 * popup) and no arithmetic on the numbers (the percentage git already
 * computed is the percentage shown). Pure, with the clock injectable, so the
 * parsing is testable without a process.
 *
 * @module git-worktree/progress
 */

/** One progress observation, in the shape of the wire's `progress` event. */
export interface GitProgress {
  /** The line as git wrote it, minus terminal control sequences. */
  text: string
  /** The `NN%` git reported, when the line has one. */
  percent?: number
  /** The remote being fetched, once the caller has named it. */
  remote?: string
}

/** Feed stderr chunks in, receive throttled events out. */
export interface ProgressReader {
  /** The caller starts fetching another remote: every observation from here
   * on carries its name, and `Fetching <name>` is shown at once. */
  remote(name: string): void
  /** Add the next stderr chunk (any split; lines may straddle chunks). */
  feed(chunk: string): void
  /** The stream ended: read a final unterminated line and flush the newest
   * observation the throttle was still holding back. */
  end(): void
}

/** Terminal control sequences (`ESC [ … K` is how a server asks a terminal to
 * erase the rest of a `remote:` line). Never wanted in a UI string. */
const CONTROL = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
/** A counted phase line: `<phase>: NN% …`, optionally behind `remote: `. The
 * percentage must sit right after the phase name, or a ref name like
 * `feat/50%-done` in an update line (or a porcelain push line) would be read
 * as progress. */
const PERCENT = /^(?:remote: )?[A-Za-z][A-Za-z ]*:\s+(\d{1,3})%/
/** The phase name in front of the first colon (`Receiving objects`). */
const PHASE = /^(?:remote: )?([^:]+):/
/** A counted phase line, the only kind that is noise inside an error text. */
const COUNTED = /^(?:remote: )?[A-Za-z][A-Za-z ]*:\s+\d{1,3}% \(\d+\/\d+\)/
/** The transfer chatter `--progress` also turns on, none of it a reason for a
 * failure: `Enumerating objects: 204, done.`, `Delta compression using up to 20
 * threads` and the `Total 203 (delta 1), reused 0 (delta 0), pack-reused 0 (from
 * 0)` summary. Left in, a rejected push opens with four lines of it and the one
 * `remote:` line that says why sits below the fold of the short error box. */
const CHATTER = /^(?:remote: )?(?:[A-Za-z][A-Za-z ]*: \d+, done\.|Delta compression using up to \d+ threads|Total \d+ \(delta \d+\), reused \d+ \(delta \d+\)(?:, pack-reused \d+(?: \(from \d+\))?)?)$/

/** Fewest milliseconds between two events of the same phase. Git redraws on
 * every percent step, which a card cannot show faster than it can be read. */
const DEFAULT_INTERVAL_MS = 150

/**
 * Create a reader.
 * @param emit - receives each observation that passes the throttle.
 * @param options - `intervalMs` throttle window, `now` clock (for tests).
 * @returns the reader.
 */
export function createProgressReader(
  emit: (progress: GitProgress) => void,
  options: { intervalMs?: number; now?: () => number } = {},
): ProgressReader {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const now = options.now ?? Date.now
  let buffer = ''
  let remote: string | undefined
  let phase: string | undefined
  let lastSentAt = Number.NEGATIVE_INFINITY
  let held: GitProgress | undefined

  const send = (progress: GitProgress): void => {
    held = undefined
    lastSentAt = now()
    emit(progress)
  }

  const read = (raw: string): void => {
    const line = raw.replace(CONTROL, '').trim()
    if (line === '') return
    const percent = PERCENT.exec(line)?.[1]
    // `From …`, ref updates and `remote: Total …` are not progress.
    if (percent === undefined) return
    const progress: GitProgress = { text: line, percent: Math.min(100, Number(percent)), ...remote === undefined ? {} : { remote } }
    const name = PHASE.exec(line)?.[1]
    // A new phase is always worth showing at once; only repeats are throttled.
    if (name !== phase || now() - lastSentAt >= intervalMs) {
      phase = name
      send(progress)
    } else {
      held = progress
    }
  }

  const flush = (): void => {
    if (buffer !== '') read(buffer)
    buffer = ''
    if (held !== undefined) send(held)
  }

  return {
    remote(name) {
      // What the previous remote still held back is its last word: say it
      // before moving on, still under its own name.
      flush()
      remote = name
      phase = undefined
      send({ text: `Fetching ${name}`, remote: name })
    },
    feed(chunk) {
      buffer += chunk
      const lines = buffer.split(/[\r\n]/)
      buffer = lines.pop() ?? ''
      for (const line of lines) read(line)
    },
    end: flush,
  }
}

/**
 * Remove git's counted progress lines and the transfer chatter around them from
 * a captured stderr, so an error built from it names the failure instead of
 * burying it under a thousand `Receiving objects: 41% …` redraws.
 * @param text - the full stderr of a `--progress` run.
 * @returns the remaining lines, `\r` redraws unrolled.
 */
export function stripProgress(text: string): string {
  return text
    .split(/\r?\n/)
    .flatMap(line => line.split('\r'))
    .map(segment => segment.replace(CONTROL, '').trimEnd())
    .filter(segment => segment.trim() !== '' && !COUNTED.test(segment.trim()) && !CHATTER.test(segment.trim()))
    .join('\n')
}
