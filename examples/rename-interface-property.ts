/**
 * Rename Account.displayName to Account.label. The checker decides which identifiers refer to
 * the property, so same-named properties on other types are left alone.
 */
import { Effect } from "effect"
import type { Identifier } from "typescript/unstable/ast"
import {
  isBindingElement,
  isElementAccessExpression,
  isIdentifier,
  isPropertySignatureDeclaration,
  isShorthandPropertyAssignment,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import * as Draft from "../src/Draft.ts"
import * as ProjectRelativePath from "../src/ProjectRelativePath.ts"
import * as Query from "../src/Query.ts"
import * as Recipe from "../src/Recipe.ts"
import { WorkspaceSnapshot } from "../src/Workspace/index.ts"

const DECLARATION_FILE = ProjectRelativePath.schema.make("src/account.ts")
const OLD_NAME = "displayName"
const NEW_NAME = "label"

const keepsLocalBinding = (node: Identifier): boolean =>
  isShorthandPropertyAssignment(node.parent) ||
  (isBindingElement(node.parent) &&
    node.parent.name === node &&
    node.parent.propertyName === undefined)

export const renameInterfaceProperty = Recipe.define("rename-interface-property", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = snapshot.projects[0]
      if (project === undefined) return Draft.empty

      const [declaration] = yield* Query.identifiers(project).pipe(
        Query.within(DECLARATION_FILE),
        Query.filter(
          ({ value }) => value.text === OLD_NAME && isPropertySignatureDeclaration(value.parent),
        ),
        Query.collect,
      )
      if (declaration === undefined) return Draft.empty

      const references = yield* Query.referencesTo(declaration).pipe(
        Query.filter((selection): selection is Query.Selection<Identifier> =>
          isIdentifier(selection.value),
        ),
        Query.collect,
      )
      const computed = yield* Query.nodes(project, isElementAccessExpression).pipe(
        Query.filter(
          ({ value }) =>
            isStringLiteral(value.argumentExpression) && value.argumentExpression.text === OLD_NAME,
        ),
        Query.collect,
      )

      return Draft.concat(
        Draft.replaceEach(references, ({ value }) =>
          keepsLocalBinding(value) ? `${NEW_NAME}: ${OLD_NAME}` : NEW_NAME,
        ),
        ...computed.map((selection) =>
          Draft.unsupported(
            selection,
            `Computed Account[${JSON.stringify(OLD_NAME)}] access requires manual review`,
          ),
        ),
      )
    }),
})
