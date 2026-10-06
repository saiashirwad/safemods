/**
 * Turn `let` into `const` where no name it declares is ever written again.
 *
 * Writes are what the compiler resolves to the declared symbol in an assignment, a compound
 * assignment, `++`/`--`, or the target of a destructuring assignment. A `let` without an
 * initializer is left alone, since `const` requires one.
 */
import { Proposal, Query, Recipe, type Workspace } from "safemods"
import { Effect } from "effect"
import {
  type BindingName,
  type Node,
  NodeFlags,
  SyntaxKind,
  type VariableDeclarationList,
} from "typescript/unstable/ast"
import {
  isArrayLiteralExpression,
  isBinaryExpression,
  isBindingElement,
  isForInStatement,
  isForOfStatement,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
  isVariableDeclarationList,
} from "typescript/unstable/ast/is"
import type { Symbol as NativeSymbol } from "typescript/unstable/async"

const isDestructuringTarget = (node: Node): boolean => {
  let target = node
  while (
    isArrayLiteralExpression(target.parent) ||
    isObjectLiteralExpression(target.parent) ||
    isPropertyAssignment(target.parent) ||
    isShorthandPropertyAssignment(target.parent) ||
    isSpreadElement(target.parent) ||
    isSpreadAssignment(target.parent)
  ) {
    target = target.parent
  }
  if (target === node) return false
  const parent = target.parent
  return (
    (isBinaryExpression(parent) &&
      parent.left === target &&
      parent.operatorToken.kind === SyntaxKind.EqualsToken) ||
    ((isForOfStatement(parent) || isForInStatement(parent)) && parent.initializer === target)
  )
}

const namesIn = (name: BindingName): ReadonlyArray<Node> =>
  isIdentifier(name) ?
    [name] :
    name.elements.flatMap((element) =>
      isBindingElement(element) && element.name !== undefined ? namesIn(element.name) : []
    )

const canonical = (project: Workspace.ProjectSnapshot, node: Node) =>
  Effect.gen(function* () {
    const symbol = yield* project.symbolOf(node)
    return symbol === undefined ? undefined : yield* project.canonicalSymbol(symbol)
  })

const writtenSymbols = (project: Workspace.ProjectSnapshot) =>
  Effect.gen(function* () {
    const writes = yield* Query.semanticReferences(project).pipe(
      Query.filter(({ value }) => value.role === "write" || isDestructuringTarget(value.node)),
    )
    const symbols = yield* Effect.forEach(writes, ({ value }) => canonical(project, value.node), {
      concurrency: "unbounded",
    })
    return new Set(symbols.filter((symbol) => symbol !== undefined))
  })

const neverWritten = (
  project: Workspace.ProjectSnapshot,
  written: ReadonlySet<NativeSymbol>,
  list: VariableDeclarationList,
) =>
  Effect.gen(function* () {
    const inLoopHead = isForOfStatement(list.parent) || isForInStatement(list.parent)
    if (
      !inLoopHead && list.declarations.some((declaration) => declaration.initializer === undefined)
    ) {
      return false
    }
    const names = list.declarations.flatMap((declaration) => namesIn(declaration.name))
    const symbols = yield* Effect.forEach(names, (name) => canonical(project, name))
    return symbols.every((symbol) => symbol !== undefined && !written.has(symbol))
  })

export const letToConst = Recipe.perProject("let-to-const", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (project) =>
    Effect.gen(function* () {
      const written = yield* writtenSymbols(project)
      const lists = yield* Query.nodes(project, isVariableDeclarationList).pipe(
        Query.filter(({ value }) => (value.flags & NodeFlags.BlockScoped) === NodeFlags.Let),
        Query.where(({ value }) => neverWritten(project, written, value)),
      )
      return Proposal.concat(
        ...lists.map((list) => Proposal.replaceRange(list, { start: 0, end: 3 }, "const")),
      )
    }),
})

export default letToConst
