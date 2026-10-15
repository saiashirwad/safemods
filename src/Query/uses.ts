import { Effect, Option } from "effect"
import type { CallExpression, Node } from "typescript/unstable/ast"
import {
  isCallExpression,
  isImportClause,
  isImportSpecifier,
  isPropertyAccessExpression,
} from "typescript/unstable/ast/is"
import type { Symbol as NativeSymbol } from "typescript/unstable/async"
import * as Pattern from "../Pattern.ts"
import type { ProjectFile, ProjectSnapshot, ProjectSnapshotError } from "../Workspace/index.ts"
import { type Query, type Selection, selectionOf, sorted } from "./selection.ts"

export const nameOf = (declaration: Node): Node | undefined =>
  "name" in declaration && Pattern.isNode(declaration.name) ? declaration.name : undefined

export const declarationIn = (
  project: ProjectSnapshot,
  symbol: NativeSymbol,
  file: ProjectFile,
): Effect.Effect<Selection<Node> | undefined, ProjectSnapshotError> =>
  Effect.map(project.declarationsOf(symbol), (declarations) =>
    declarations
      .flatMap((declaration) => Option.toArray(selectionOf(project, declaration)))
      .find((selection) => selection.fileName === file.fileName))

export const referencesTo = (selection: Selection<Node>): Query<Node, ProjectSnapshotError> =>
  Effect.map(
    selection.project.referencesTo(selection.value),
    (nodes) =>
      sorted(nodes.flatMap((node) => Option.toArray(selectionOf(selection.project, node)))),
  )

export interface Uses {
  readonly calls: ReadonlyArray<Selection<CallExpression>>
  readonly escapes: boolean
}

export const usesOf = (selection: Selection<Node>): Effect.Effect<Uses, ProjectSnapshotError> =>
  Effect.map(referencesTo(selection), (references) => {
    const calls: Array<Selection<CallExpression>> = []
    let escapes = false
    for (const { project, value } of references) {
      if (
        value === selection.value ||
        isImportSpecifier(value.parent) ||
        (isImportClause(value.parent) && value.parent.name === value)
      ) {
        continue
      }
      const callee = isPropertyAccessExpression(value.parent) && value.parent.name === value ?
        value.parent :
        value
      const call = isCallExpression(callee.parent) && callee.parent.expression === callee ?
        selectionOf(project, callee.parent) :
        Option.none()
      if (Option.isSome(call)) calls.push(call.value)
      else escapes = true
    }
    return { calls, escapes }
  })
