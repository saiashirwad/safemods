/**
 * Add `as const` to exported objects whose every property is a string or number literal, so
 * importers see the literal values instead of `string` and `number`.
 */
import { Proposal, Pattern as P, Query, Recipe } from "safemods"
import { Effect } from "effect"
import { type Node, NodeFlags, SyntaxKind } from "typescript/unstable/ast"
import {
  isNumericLiteral,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
  isVariableDeclaration,
  isVariableStatement,
} from "typescript/unstable/ast/is"

const isExportedConst = (declaration: Node): boolean => {
  const list = declaration.parent
  const statement = list.parent
  return (
    (list.flags & NodeFlags.Const) !== 0 &&
    isVariableStatement(statement) &&
    statement.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) === true
  )
}

const isLiteral = (node: Node): boolean => isStringLiteral(node) || isNumericLiteral(node)

export const objectAsConst = Recipe.perProject("object-as-const", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (project) =>
    Query.nodes(project, isVariableDeclaration).pipe(
      Query.filter(({ value }) => isExportedConst(value)),
      Query.shape({
        type: undefined,
        initializer: P.bind("object", P.node(isObjectLiteralExpression)),
      }),
      Query.filter(({ value }) =>
        value.captures.object.properties.every((property) =>
          isPropertyAssignment(property) && isLiteral(property.initializer)
        )
      ),
      Effect.map((declarations) =>
        Proposal.concat(
          ...declarations.map(({ value }) =>
            Proposal.insertAfter(project, value.captures.object, " as const")
          ),
        )
      ),
    ),
})

export default objectAsConst
