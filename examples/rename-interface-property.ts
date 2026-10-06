/**
 * Rename Account.displayName to Account.label. The checker decides which identifiers refer to
 * the property, so same-named properties on other types are left alone.
 */
import { Proposal, Pattern as P, WorkspacePath, Query, Recipe } from "safemods"
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

const DECLARATION_FILE = WorkspacePath.schema.make("src/account.ts")
const OLD_NAME = "displayName"
const NEW_NAME = "label"

const localBinding = P.node(isBindingElement, {
  propertyName: undefined,
  name: P.capture("bound"),
})

const computedAccess = P.node(isElementAccessExpression, {
  argumentExpression: P.node(isStringLiteral, { text: OLD_NAME }),
})

const keepsLocalBinding = (node: Identifier): boolean =>
  isShorthandPropertyAssignment(node.parent) || localBinding.match(node.parent)?.bound === node

export const renameInterfaceProperty = Recipe.define("rename-interface-property", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (snapshot) =>
    Effect.gen(function* () {
      const project = snapshot.projects[0]
      if (project === undefined) return Proposal.empty

      const [declaration] = yield* Query.identifiers(project).pipe(
        Query.within(DECLARATION_FILE),
        Query.filter(
          ({ value }) => value.text === OLD_NAME && isPropertySignatureDeclaration(value.parent),
        ),
      )
      if (declaration === undefined) return Proposal.empty

      const references = yield* Query.referencesTo(declaration).pipe(
        Query.filter((selection): selection is Query.Selection<Identifier> =>
          isIdentifier(selection.value)
        ),
      )
      const computed = yield* Query.match(project, { computedAccess })

      return Proposal.concat(
        Proposal.replaceEach(references, ({ value }) =>
          keepsLocalBinding(value) ? `${NEW_NAME}: ${OLD_NAME}` : NEW_NAME),
        ...computed.map((selection) =>
          Proposal.unsupported(
            selection,
            `Computed Account[${JSON.stringify(OLD_NAME)}] access requires manual review`,
          )
        ),
      )
    }),
})

export default renameInterfaceProperty
