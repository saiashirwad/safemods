/**
 * Replace conservative variable-initializer `as Type` assertions with `satisfies Type`.
 *
 * Parenthesized and chained assertions are reported rather than rewritten because changing
 * their precedence or intermediate asserted type can change meaning. `as const` and assertions
 * outside a variable initializer are intentionally unrelated to this migration.
 */
import { Proposal, Pattern as P, Query, Recipe } from "safemods"
import { Effect } from "effect"
import type { AsExpression } from "typescript/unstable/ast"
import {
  isAsExpression,
  isIdentifier,
  isParenthesizedExpression,
  isTypeReferenceNode,
  isVariableDeclaration,
} from "typescript/unstable/ast/is"

const needsReview = P.tagged({
  "chained assertion requires manual review": P.node(isAsExpression, {
    expression: P.node(isAsExpression),
  }),
  "const assertion is not a type conformance check": P.node(isAsExpression, {
    type: P.node(isTypeReferenceNode, { typeName: P.node(isIdentifier, { text: "const" }) }),
  }),
  "parenthesized assertion requires manual review": P.node(isAsExpression, {
    expression: P.node(isParenthesizedExpression),
  }),
})

const isVariableInitializer = (node: AsExpression): boolean =>
  isVariableDeclaration(node.parent) && node.parent.initializer === node

const operatorRange = (node: AsExpression): { readonly start: number; readonly end: number } => {
  const source = node.getSourceFile()
  const expressionEnd = node.expression.getEnd()
  const between = source.text.slice(expressionEnd, node.type.getStart(source))
  const keyword = /\bas\b/.exec(between)
  if (keyword === null) throw new Error("As-expression has no as keyword")
  const start = expressionEnd - node.getStart(source) + keyword.index
  return { start, end: start + keyword[0].length }
}

const draftFor = (selection: Query.Selection<AsExpression>): Proposal.Proposal => {
  const review = needsReview(selection.value)
  return review === undefined ?
    Proposal.replaceRange(selection, operatorRange(selection.value), "satisfies") :
    Proposal.unsupported(selection, review._tag)
}

export const asAssertionToSatisfies = Recipe.perProject("as-assertion-to-satisfies", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (project) =>
    Query.nodes(project, isAsExpression).pipe(
      Query.filter((selection) => isVariableInitializer(selection.value)),
      Effect.map((selections) => Proposal.concat(...selections.map(draftFor))),
    ),
})

export default asAssertionToSatisfies
