import { describe, expect, it, vi } from 'vitest'
import {
  copyWorktreeFiles,
  formatCopyWarning,
  isSafeRelativePath,
  parseWorktreeInclude,
  runPostCreateCopy,
  type CopyFilesSeams,
} from '../src/copy-files.js'

describe('parseWorktreeInclude', () => {
  it('parses line-by-line relative paths', () => {
    const content = '.env\nconfig/secrets.json\nlocal.settings.json'
    expect(parseWorktreeInclude(content)).toEqual([
      '.env',
      'config/secrets.json',
      'local.settings.json',
    ])
  })

  it('skips empty lines and whitespace-only lines', () => {
    const content = '\n  \n.env\n\n\nconfig/secrets.json\n   \n'
    expect(parseWorktreeInclude(content)).toEqual([
      '.env',
      'config/secrets.json',
    ])
  })

  it('skips comment lines starting with #', () => {
    const content = '# Local configs\n.env\n# Secrets\n   # Indented comment\nconfig/secrets.json'
    expect(parseWorktreeInclude(content)).toEqual([
      '.env',
      'config/secrets.json',
    ])
  })

  it('handles CRLF line endings', () => {
    const content = '.env\r\n# comment\r\nconfig/secrets.json\r\n'
    expect(parseWorktreeInclude(content)).toEqual([
      '.env',
      'config/secrets.json',
    ])
  })

  it('trims whitespace around paths and deduplicates identical entries', () => {
    const content = '  .env  \n.env\nconfig/local.json\n  config/local.json  '
    expect(parseWorktreeInclude(content)).toEqual([
      '.env',
      'config/local.json',
    ])
  })
})

describe('isSafeRelativePath', () => {
  it('accepts valid relative paths', () => {
    expect(isSafeRelativePath('.env')).toBe(true)
    expect(isSafeRelativePath('.env.local')).toBe(true)
    expect(isSafeRelativePath('config/secrets.json')).toBe(true)
    expect(isSafeRelativePath('a/b/c/d.txt')).toBe(true)
  })

  it('rejects empty or whitespace-only paths', () => {
    expect(isSafeRelativePath('')).toBe(false)
    expect(isSafeRelativePath('   ')).toBe(false)
  })

  it('rejects paths containing .. segments', () => {
    expect(isSafeRelativePath('..')).toBe(false)
    expect(isSafeRelativePath('../foo')).toBe(false)
    expect(isSafeRelativePath('foo/../bar')).toBe(false)
    expect(isSafeRelativePath('foo/bar/..')).toBe(false)
    expect(isSafeRelativePath('..\\foo')).toBe(false)
    expect(isSafeRelativePath('foo\\..\\bar')).toBe(false)
  })

  it('rejects absolute paths on POSIX and Windows', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
    expect(isSafeRelativePath('/.env')).toBe(false)
    expect(isSafeRelativePath('\\windows\\file')).toBe(false)
    expect(isSafeRelativePath('C:\\secrets.txt')).toBe(false)
    expect(isSafeRelativePath('D:/secrets.txt')).toBe(false)
    expect(isSafeRelativePath('\\\\server\\share\\file')).toBe(false)
  })
})

describe('copyWorktreeFiles', () => {
  it('copies existing source files to destination when destination does not exist', async () => {
    const existsTable: Record<string, boolean> = {
      '/repo/.env': true,
      '/repo/config/secrets.json': true,
      '/target/.env': false,
      '/target/config/secrets.json': false,
    }
    const copied: [string, string][] = []
    const directories: string[] = []

    const seams: CopyFilesSeams = {
      exists: async (p) => !!existsTable[p.replace(/\\/g, '/')],
      mkdir: async (p) => { directories.push(p.replace(/\\/g, '/')) },
      copyFile: async (src, dest) => { copied.push([src.replace(/\\/g, '/'), dest.replace(/\\/g, '/')]) },
    }

    const failures = await copyWorktreeFiles(['.env', 'config/secrets.json'], '/repo', '/target', seams)
    expect(failures).toEqual([])
    expect(copied).toEqual([
      ['/repo/.env', '/target/.env'],
      ['/repo/config/secrets.json', '/target/config/secrets.json'],
    ])
    expect(directories).toContain('/target')
    expect(directories).toContain('/target/config')
  })

  it('silently skips files that do not exist in the source repository', async () => {
    const existsTable: Record<string, boolean> = {
      '/repo/.env': false,
    }
    const copied: [string, string][] = []

    const seams: CopyFilesSeams = {
      exists: async (p) => !!existsTable[p.replace(/\\/g, '/')],
      mkdir: async () => {},
      copyFile: async (src, dest) => { copied.push([src, dest]) },
    }

    const failures = await copyWorktreeFiles(['.env'], '/repo', '/target', seams)
    expect(failures).toEqual([])
    expect(copied).toHaveLength(0)
  })

  it('does not overwrite destination files that already exist', async () => {
    const existsTable: Record<string, boolean> = {
      '/repo/.env': true,
      '/target/.env': true, // already exists
    }
    const copied: [string, string][] = []

    const seams: CopyFilesSeams = {
      exists: async (p) => !!existsTable[p.replace(/\\/g, '/')],
      mkdir: async () => {},
      copyFile: async (src, dest) => { copied.push([src, dest]) },
    }

    const failures = await copyWorktreeFiles(['.env'], '/repo', '/target', seams)
    expect(failures).toEqual([])
    expect(copied).toHaveLength(0)
  })

  it('collects failure for unsafe paths without throwing or copying', async () => {
    const copied: [string, string][] = []
    const seams: CopyFilesSeams = {
      exists: async () => true,
      mkdir: async () => {},
      copyFile: async (src, dest) => { copied.push([src, dest]) },
    }

    const failures = await copyWorktreeFiles(['../traversal', '/absolute/path'], '/repo', '/target', seams)
    expect(failures).toHaveLength(2)
    expect(failures[0].file).toBe('../traversal')
    expect(failures[0].error).toContain('path traversal or absolute path')
    expect(failures[1].file).toBe('/absolute/path')
    expect(failures[1].error).toContain('path traversal or absolute path')
    expect(copied).toHaveLength(0)
  })

  it('collects failure when copyFile throws and continues with subsequent files', async () => {
    const copied: string[] = []
    const seams: CopyFilesSeams = {
      exists: async (p) => p.replace(/\\/g, '/').startsWith('/repo'),
      mkdir: async () => {},
      copyFile: async (src) => {
        if (src.includes('.env.secret')) {
          throw new Error('EACCES: permission denied')
        }
        copied.push(src.replace(/\\/g, '/'))
      },
    }

    const failures = await copyWorktreeFiles(['.env.secret', '.env.public'], '/repo', '/target', seams)
    expect(failures).toHaveLength(1)
    expect(failures[0].file).toBe('.env.secret')
    expect(failures[0].error).toContain('EACCES')
    expect(copied).toEqual(['/repo/.env.public'])
  })
})

describe('formatCopyWarning', () => {
  it('returns undefined when there are no failures', () => {
    expect(formatCopyWarning([])).toBeUndefined()
  })

  it('formats multiple failures with file name and error description', () => {
    const warning = formatCopyWarning([
      { file: '.env', error: 'EACCES: permission denied' },
      { file: '../secret', error: 'path traversal or absolute path is not allowed' },
    ])
    expect(warning).toBe('Failed to copy configuration files: .env: EACCES: permission denied; ../secret: path traversal or absolute path is not allowed')
  })
})

describe('runPostCreateCopy', () => {
  it('reads and uses .worktreeinclude when present', async () => {
    const copied: [string, string][] = []
    const seams: CopyFilesSeams = {
      readFile: async (p) => p.replace(/\\/g, '/').endsWith('/.worktreeinclude') ? '.env\nconfig/local.json' : null,
      exists: async (p) => p.replace(/\\/g, '/').startsWith('/repo'),
      mkdir: async () => {},
      copyFile: async (src, dest) => { copied.push([src.replace(/\\/g, '/'), dest.replace(/\\/g, '/')]) },
    }

    const warning = await runPostCreateCopy({ copyFilesSeams: seams }, '/repo', '/target')
    expect(warning).toBeUndefined()
    expect(copied).toEqual([
      ['/repo/.env', '/target/.env'],
      ['/repo/config/local.json', '/target/config/local.json'],
    ])
  })

  it('does not fallback to global settings when .worktreeinclude is present even if empty', async () => {
    const copied: [string, string][] = []
    const seams: CopyFilesSeams = {
      readFile: async () => '# only comments\n\n',
      exists: async () => true,
      mkdir: async () => {},
      copyFile: async (src, dest) => { copied.push([src, dest]) },
    }

    const warning = await runPostCreateCopy(
      {
        sectionPostCreateCopyFiles: () => ['.env'],
        copyFilesSeams: seams,
      },
      '/repo',
      '/target',
    )
    expect(warning).toBeUndefined()
    expect(copied).toHaveLength(0)
  })

  it('falls back to sectionPostCreateCopyFiles when .worktreeinclude is absent (null)', async () => {
    const copied: [string, string][] = []
    const seams: CopyFilesSeams = {
      readFile: async () => null,
      exists: async (p) => p.replace(/\\/g, '/').startsWith('/repo'),
      mkdir: async () => {},
      copyFile: async (src, dest) => { copied.push([src.replace(/\\/g, '/'), dest.replace(/\\/g, '/')]) },
    }

    const warning = await runPostCreateCopy(
      {
        sectionPostCreateCopyFiles: () => ['.env', 'config.json'],
        copyFilesSeams: seams,
      },
      '/repo',
      '/target',
    )
    expect(warning).toBeUndefined()
    expect(copied).toEqual([
      ['/repo/.env', '/target/.env'],
      ['/repo/config.json', '/target/config.json'],
    ])
  })

  it('triggers no I/O when both .worktreeinclude and fallback are absent/empty', async () => {
    const existsSpy = vi.fn().mockResolvedValue(true)
    const seams: CopyFilesSeams = {
      readFile: async () => null,
      exists: existsSpy,
      mkdir: async () => {},
      copyFile: async () => {},
    }

    const warning = await runPostCreateCopy(
      {
        sectionPostCreateCopyFiles: () => undefined,
        copyFilesSeams: seams,
      },
      '/repo',
      '/target',
    )
    expect(warning).toBeUndefined()
    expect(existsSpy).not.toHaveBeenCalled()
  })

  it('returns warning when reading .worktreeinclude encounters an error', async () => {
    const seams: CopyFilesSeams = {
      readFile: async () => { throw new Error('EACCES: permission denied') },
      exists: async () => true,
      mkdir: async () => {},
      copyFile: async () => {},
    }

    const warning = await runPostCreateCopy({ copyFilesSeams: seams }, '/repo', '/target')
    expect(warning).toContain('Failed to read .worktreeinclude')
    expect(warning).toContain('EACCES')
  })

  it('returns formatted copyWarning when copyWorktreeFiles reports failures', async () => {
    const seams: CopyFilesSeams = {
      readFile: async () => '.env\n',
      exists: async (p) => p.replace(/\\/g, '/').startsWith('/repo'),
      mkdir: async () => {},
      copyFile: async () => { throw new Error('Disk full') },
    }

    const warning = await runPostCreateCopy({ copyFilesSeams: seams }, '/repo', '/target')
    expect(warning).toBe('Failed to copy configuration files: .env: Disk full')
  })
})
