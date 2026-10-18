import { describe, expect, it } from 'vitest'
import { filterCommits, layoutCommits } from '../src/client/commit-graph.ts'
import type { HistoryCommit } from '../src/wire.ts'

describe('filtered commit selection', () => {
  const commits: HistoryCommit[] = [
    { oid: 'a'.repeat(40), subject: 'Release', author: 'Alice', parents: [], date: '2026-10-18T12:00:00Z' },
    { oid: 'b'.repeat(40), subject: 'Fix graph', author: 'Bob', parents: [], date: '2026-10-17T12:00:00Z' },
    { oid: 'c'.repeat(40), subject: 'Fix filters', author: 'Bob', parents: [], date: '2026-10-16T12:00:00Z' },
  ]

  it('selects the first matching author and retains original graph indexes', () => {
    expect(filterCommits(commits, '', 'Bob', commits[0]!.oid)).toEqual({
      visible: [{ item: commits[1], index: 1 }, { item: commits[2], index: 2 }], selected: commits[1]!.oid,
    })
  })

  it('preserves a visible selection and falls back when searching hides it', () => {
    expect(filterCommits(commits, 'fix', 'Bob', commits[2]!.oid).selected).toBe(commits[2]!.oid)
    expect(filterCommits(commits, ' GRAPH ', '', commits[2]!.oid).selected).toBe(commits[1]!.oid)
    expect(filterCommits(commits, 'BBBB', '', null).selected).toBe(commits[1]!.oid)
  })

  it('clears selection for zero matches and combines author with text or hash', () => {
    expect(filterCommits(commits, 'release', 'Bob', commits[0]!.oid)).toEqual({ visible: [], selected: null })
    expect(filterCommits(commits, 'Alice', '', commits[0]!.oid)).toEqual({ visible: [], selected: null })
    expect(filterCommits([], '', '', commits[0]!.oid)).toEqual({ visible: [], selected: null })
  })
})

describe('topological commit graph lanes', () => {
  it('connects both merge parents through unrelated rows and rejoins their common ancestor', () => {
    const { rows, lanes } = layoutCommits([
      { oid: 'merge', parents: ['main', 'topic'] },
      { oid: 'main', parents: ['root'] },
      { oid: 'topic', parents: ['root'] },
      { oid: 'root', parents: [] },
    ])
    expect(lanes).toBe(2)
    expect(rows[0]).toEqual({ lane: 0, incoming: false, edges: [
      { from: 0, to: 0, parent: true }, { from: 0, to: 1, parent: true },
    ] })
    expect(rows[1]?.edges).toContainEqual({ from: 1, to: 1, parent: false })
    expect(rows[2]).toMatchObject({ lane: 1, incoming: true, edges: [
      { from: 1, to: 0, parent: true }, { from: 0, to: 0, parent: false },
    ] })
    expect(rows[3]).toEqual({ lane: 0, incoming: true, edges: [] })
  })

  it('keeps earlier rows stable when a page appends missing ancestors', () => {
    const prefix = [{ oid: 'merge', parents: ['main', 'topic'] }, { oid: 'main', parents: ['root'] }]
    expect(layoutCommits([...prefix, { oid: 'topic', parents: ['root'] }, { oid: 'root', parents: [] }]).rows.slice(0, 2))
      .toEqual(layoutCommits(prefix).rows)
    expect(layoutCommits([])).toEqual({ rows: [], lanes: 1 })
  })

  it('reuses empty lanes and preserves all octopus merge edges', () => {
    const { rows, lanes } = layoutCommits([{ oid: 'merge', parents: ['a', 'b', 'c'] },
      { oid: 'a', parents: [] }, { oid: 'b', parents: [] }, { oid: 'c', parents: [] }, { oid: 'orphan', parents: [] }])
    expect(lanes).toBe(3)
    expect(rows[0]?.edges.filter(edge => edge.parent)).toHaveLength(3)
    expect(rows.at(-1)?.lane).toBe(0)
  })
})
