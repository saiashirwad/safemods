/**
 * Rewrite `a + b` that builds a string into a template literal.
 *
 * Only a single `+` whose operands are both typed string or number is rewritten, since for
 * those `+` and a template produce the same text; an object operand may convert differently.
 * Longer chains are reported for a person to rewrite.
 */
import { Effect } from "effect"
import { type Expression, type Node, SyntaxKind } from "typescript/unstable/ast"
import { isBinaryExpression, isStringLiteral } from "typescript/unstable/ast/is"
import type { Type as NativeType } from "typescript/unstable/async"
import * as Draft from "safemods/Draft"
import * as P from "safemods/Pattern"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ProjectSnapshot, WorkspaceSnapshot } from "safemods/Workspace"

const isPlus = (node: Node): node is Node => node.kind === SyntaxKind.PlusToken

const isConcatenation = (node: Node): boolean =>
  isBinaryExpression(node) && isPlus(node.operatorToken)

const isPrintable = (project: ProjectSnapshot, type: NativeType | undefined) =>
  Effect.gen(function* () {
    if (type === undefined) return false
    const [text, number] = yield* Effect.all([
      project.intrinsicType("string"),
      project.intrinsicType("number"),
    ])
    return (
      (yield* project.isTypeAssignableTo(type, text)) ||
      (yield* project.isTypeAssignableTo(type, number))
    )
  })

const part = (operand: Expression): string =>
  isStringLiteral(operand) ?
    operand.getText().slice(1, -1).replaceAll("`", "\\`").replaceAll("${", "\\${") :
    `\${${operand.getText()}}`

export const concatToTemplate = Recipe.define("concat-to-template", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const drafts = yield* Effect.forEach(snapshot.projects, (project) =>
        Query.nodes(project, isBinaryExpression).pipe(
          Query.filter(({ value }) =>
            !isConcatenation(value.parent)
          ),
          Query.where(Query.typeAssignableTo("string")),
          Query.shape({
            left: P.capture("left"),
            operatorToken: P.node(isPlus),
            right: P.capture("right"),
          }),
          Query.typedCaptures,
          Query.where(({ value }) =>
            Effect.map(
              Effect.all([
                isPrintable(project, value.types.left),
                isPrintable(project, value.types.right),
              ]),
              ([left, right]) => left && right,
            )
          ),
          Query.collect,
          Effect.map((concatenations) =>
            Draft.concat(
              ...concatenations.map((selection) => {
                const { left, right } = selection.value.captures
                return isConcatenation(left) ?
                  Draft.unsupported(selection, "a chain of + needs rewriting by hand") :
                  Draft.replaceSelection(
                    { ...selection, value: selection.value.node },
                    `\`${part(left)}${part(right)}\``,
                  )
              }),
            )
          ),
        ))
      return Draft.concat(...drafts)
    }),
})
