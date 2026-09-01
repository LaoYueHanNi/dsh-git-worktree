/**
 * Static gate for the render-time TDZ class: a component's eagerly evaluated
 * JSX (a JSX expression assigned to a const — its inline .map callbacks run at
 * render, NOT lazily) must not reference a const declared LATER in the same
 * function body. Both existing gates missed the 2026-09-01 crash of exactly
 * this shape: tsc does not model closure capture order, and the pure-function
 * specs never render components. Rendering the component for real is not an
 * option in a standalone vitest (the DSH client packages are
 * `window.__ModuleLoader__` registration bundles that only execute inside the
 * dsh web host), so this spec parses the source with the compiler API instead.
 *
 * The rule is deliberately conservative: it counts EVERY identifier inside a
 * JSX-valued const's initializer (event-handler closures included), so a
 * false positive is possible for a lazily-invoked handler referencing a later
 * const — acceptable noise for a real class of crash.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

/** Client component sources the gate watches. */
const WATCHED = ['GroupedSidebar.tsx', 'sidebar-rows.tsx', 'BranchChip.tsx', 'GitWorktreeCard.tsx'] as const

/** One violation: a later-declared const referenced by an earlier JSX const. */
interface ForwardUse {
  file: string
  function: string
  jsxConst: string
  referenced: string
}

/** Does the expression subtree contain any JSX (element, fragment, attribute)? */
function containsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)) return true
  return node.getChildren().some(containsJsx)
}

/** Collect identifier REFERENCES in an expression: JSX attribute names and
 * non-shorthand property keys are positions, not references. Walks with
 * getChildren (the full syntactic tree) rather than forEachChild — forEachChild's
 * slot-based traversal does not reach every JSX descendant (verified: the
 * whenFalse branch of a conditional JSX initializer stayed unvisited). */
function identifierReferences(node: ts.Node, out: ts.Identifier[] = []): ts.Identifier[] {
  if (ts.isIdentifier(node)) {
    out.push(node)
  } else if (ts.isJsxAttribute(node)) {
    // Skip the attribute NAME; its initializer (the value expression) still walks.
    node.initializer?.getChildren().forEach(child => identifierReferences(child, out))
  } else if (ts.isPropertyAssignment(node)) {
    // Non-shorthand key is a position; only the value walks.
    identifierReferences(node.initializer, out)
  } else {
    node.getChildren().forEach(child => identifierReferences(child, out))
  }
  return out
}

/** Scan one function-like body (function or arrow) for forward JSX uses. */
function scanBody(body: ts.Block, fnName: string, file: string, out: ForwardUse[]): void {
  // const-name -> statement position, for EVERY direct const declaration.
  const constAt = new Map<string, number>()
  // Direct statements whose initializer is JSX-valued (eagerly evaluated).
  const jsxStatements: { name: string; position: number; initializer: ts.Expression }[] = []
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      constAt.set(declaration.name.text, statement.getStart())
      if (containsJsx(declaration.initializer)) {
        jsxStatements.push({ name: declaration.name.text, position: statement.getStart(), initializer: declaration.initializer })
      }
    }
  }
  for (const jsx of jsxStatements) {
    for (const reference of identifierReferences(jsx.initializer)) {
      const declaredAt = constAt.get(reference.text)
      if (declaredAt !== undefined && declaredAt > jsx.position) {
        out.push({ file, function: fnName, jsxConst: jsx.name, referenced: reference.text })
      }
    }
  }
}

/** All function-like declarations in a source file, with their block bodies. */
function functionBodies(source: ts.SourceFile): Array<{ name: string; body: ts.Block }> {
  const found: Array<{ name: string; body: ts.Block }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.body !== undefined && node.name !== undefined) {
      found.push({ name: node.name.text, body: node.body })
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : undefined
        const body = declaration.initializer !== undefined && ts.isArrowFunction(declaration.initializer) && ts.isBlock(declaration.initializer.body)
          ? declaration.initializer.body
          : undefined
        if (name !== undefined && body !== undefined) found.push({ name, body })
      }
    }
    node.forEachChild(visit)
  }
  visit(source)
  return found
}

describe('eager-JSX forward-reference gate', () => {
  it('watches every client component for JSX consts referencing later consts', () => {
    const violations: ForwardUse[] = []
    for (const file of WATCHED) {
      const source = ts.createSourceFile(join('src', 'client', file), readFileSync(join('src', 'client', file), 'utf8'), ts.ScriptTarget.Latest, true)
      for (const { name, body } of functionBodies(source)) scanBody(body, name, file, violations)
    }
    expect(violations).toEqual([])
  })
})
