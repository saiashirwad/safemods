/**
 * Add `as const` to exported objects whose every property is a string or number literal, so
 * importers see the literal values instead of `string` and `number`.
 */
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
import * as Draft from "safemods/Draft"
import * as P from "safemods/Pattern"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

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

export const objectAsConst = Recipe.define("object-as-const", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const drafts = yield* Effect.forEach(snapshot.projects, (project) =>
        Query.nodes(project, isVariableDeclaration).pipe(
          Query.filter(({ value }) =>
            isExportedConst(value)
          ),
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
            Draft.concat(
              ...declarations.map(({ value }) =>
                Draft.insertAfter(project, value.captures.object, " as const")
              ),
            )
          ),
        ))
      return Draft.concat(...drafts)
    }),
})
