/**
 * Replace conservative variable-initializer `as Type` assertions with `satisfies Type`.
 *
 * Parenthesized and chained assertions are reported rather than rewritten because changing
 * their precedence or intermediate asserted type can change meaning. `as const` and assertions
 * outside a variable initializer are intentionally unrelated to this migration.
 */
import { Effect } from "effect"
import type { AsExpression, Node } from "typescript/unstable/ast"
import {
  isAsExpression,
  isParenthesizedExpression,
  isVariableDeclaration,
} from "typescript/unstable/ast/is"
import * as Draft from "../src/Draft.ts"
import * as Query from "../src/Query.ts"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const unsupportedReason = (node: AsExpression): string | undefined => {
  if (isAsExpression(node.expression)) return "chained assertion requires manual review"
  if (node.type.getText() === "const") return "const assertion is not a type conformance check"
  if (isParenthesizedExpression(node.expression)) {
    return "parenthesized assertion requires manual review"
  }
  return undefined
}

const isVariableInitializer = (node: AsExpression): boolean =>
  isVariableDeclaration(node.parent) && node.parent.initializer === node

const operatorRange = (node: AsExpression): { readonly start: number; readonly end: number } => {
  const source = node.getSourceFile().text
  const expressionEnd = node.expression.getEnd()
  const typeStart = node.type.getStart(node.getSourceFile())
  const between = source.slice(expressionEnd, typeStart)
  const match = /\bas\b/.exec(between)
  if (match === null) throw new Error("As-expression has no as keyword")
  return {
    start: expressionEnd - node.getStart(node.getSourceFile()) + match.index,
    end: expressionEnd - node.getStart(node.getSourceFile()) + match.index + match[0].length,
  }
}

const draftFor = (selection: Query.Selection<AsExpression>): Draft.Draft => {
  const reason = unsupportedReason(selection.value)
  return reason === undefined
    ? Draft.replaceRange(selection, operatorRange(selection.value), "satisfies")
    : Draft.unsupported(selection, reason)
}

export const asAssertionToSatisfies = Recipe.define("as-assertion-to-satisfies", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const drafts = yield* Effect.forEach(snapshot.projects, (project) =>
        Query.nodes(project, (node: Node): node is AsExpression => isAsExpression(node)).pipe(
          Query.filter((selection) => isVariableInitializer(selection.value)),
          Query.collect,
          Effect.map((selections) => Draft.concat(...selections.map(draftFor))),
        ),
      )
      return Draft.concat(...drafts)
    }),
})
