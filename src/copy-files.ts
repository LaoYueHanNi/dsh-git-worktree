/**
 * Post-create configuration file copying: copies untracked local files
 * declared in `.worktreeinclude` (or fallback config) from the main worktree
 * to a fresh worktree directory.
 */

import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

/** One failed copy record with error details. */
export interface CopyFailure {
  file: string
  error: string
}

/** Pure I/O seams for file reading, existence probe, directory creation, and copying. */
export interface CopyFilesSeams {
  /** Read file as UTF-8; null if missing (ENOENT). */
  readFile?: (path: string) => Promise<string | null>
  /** Check whether a file or directory exists. */
  exists: (path: string) => Promise<boolean>
  /** Copy file from src to dest. */
  copyFile: (src: string, dest: string) => Promise<void>
  /** Recursive mkdir. */
  mkdir: (path: string) => Promise<void>
}

/** Real fs-backed seams. */
export const fsCopyFilesSeams: CopyFilesSeams = {
  readFile: async (path: string) => {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  },
  exists: async (path: string) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
  copyFile: async (src: string, dest: string) => {
    await copyFile(src, dest)
  },
  mkdir: async (path: string) => {
    await mkdir(path, { recursive: true })
  },
}

/**
 * Parse `.worktreeinclude` content: line-by-line exact relative paths.
 * Skips empty lines and lines starting with `#`. MVP has no glob expansion
 * or `!` negation support.
 */
export function parseWorktreeInclude(content: string): string[] {
  const result: string[] = []
  const lines = content.split(/\r?\n/)
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (!result.includes(trimmed)) {
      result.push(trimmed)
    }
  }
  return result
}

/**
 * Validate that a path is a safe relative path.
 * Rejects empty paths, absolute paths (both POSIX and Windows shapes),
 * and any path traversal containing `..` segments.
 */
export function isSafeRelativePath(relPath: string): boolean {
  if (relPath.trim() === '') return false
  if (isAbsolute(relPath) || relPath.startsWith('/') || relPath.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(relPath)) {
    return false
  }
  const segments = relPath.split(/[\\/]/)
  if (segments.some(segment => segment === '..')) {
    return false
  }
  return true
}

/**
 * Copy declared files from main worktree (repoRoot) to targetPath.
 * - Missing source files are silently skipped.
 * - Existing destination files are not overwritten.
 * - Parent directories are created recursively.
 * - Unsafe paths and copy errors are collected into failures without throwing.
 */
export async function copyWorktreeFiles(
  files: readonly string[],
  repoRoot: string,
  targetPath: string,
  seams: CopyFilesSeams = fsCopyFilesSeams,
): Promise<CopyFailure[]> {
  const failures: CopyFailure[] = []
  const unique = Array.from(new Set(files))
  for (const relPath of unique) {
    if (!isSafeRelativePath(relPath)) {
      failures.push({ file: relPath, error: 'path traversal or absolute path is not allowed' })
      continue
    }
    const src = join(repoRoot, relPath)
    const dest = join(targetPath, relPath)
    try {
      if (!(await seams.exists(src))) {
        continue
      }
      if (await seams.exists(dest)) {
        continue
      }
      await seams.mkdir(dirname(dest))
      await seams.copyFile(src, dest)
    } catch (error) {
      failures.push({
        file: relPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return failures
}

/**
 * Format copy failures into a single warning message for the client toast.
 */
export function formatCopyWarning(failures: readonly CopyFailure[]): string | undefined {
  if (failures.length === 0) return undefined
  const details = failures.map(f => `${f.file}: ${f.error}`).join('; ')
  return `Failed to copy configuration files: ${details}`
}

export interface RunCopyDeps {
  sectionPostCreateCopyFiles?: () => string[] | undefined
  copyFilesSeams?: CopyFilesSeams
}

/**
 * Coordinate post-create copying after a fresh worktree is created:
 * 1. Try reading `<repoRoot>/.worktreeinclude`.
 * 2. If present, parse it (fully overrides fallback, even if empty).
 * 3. If absent, fallback to `sectionPostCreateCopyFiles`.
 * 4. Perform copying and return formatted copyWarning if any failures occur.
 */
export async function runPostCreateCopy(
  deps: RunCopyDeps,
  repoRoot: string,
  targetPath: string,
): Promise<string | undefined> {
  const seams = deps.copyFilesSeams ?? fsCopyFilesSeams
  const includePath = join(repoRoot, '.worktreeinclude')
  let files: string[] | undefined
  try {
    const readFn = seams.readFile ?? fsCopyFilesSeams.readFile!
    const content = await readFn(includePath)
    if (content !== null) {
      files = parseWorktreeInclude(content)
    }
  } catch (error) {
    return `Failed to read .worktreeinclude: ${error instanceof Error ? error.message : String(error)}`
  }

  if (files === undefined) {
    const fallback = deps.sectionPostCreateCopyFiles?.()
    if (fallback !== undefined && fallback.length > 0) {
      files = [...fallback]
    }
  }

  if (files === undefined || files.length === 0) {
    return undefined
  }

  const failures = await copyWorktreeFiles(files, repoRoot, targetPath, seams)
  return formatCopyWarning(failures)
}
