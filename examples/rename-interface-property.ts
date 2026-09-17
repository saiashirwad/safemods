/** Safely rename Account.displayName to Account.label using checker-resolved references. */
import { Effect } from "effect"
import {
  isBindingElement,
  isElementAccessExpression,
  isPropertyAssignment,
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

export const renameInterfaceProperty = Recipe.define("rename-interface-property", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = snapshot.projects[0]
      if (project === undefined) return Draft.empty

      const declarations = yield* Query.identifiers(project).pipe(
        Query.within(DECLARATION_FILE),
        Query.filter(
          ({ value }) => value.text === OLD_NAME && isPropertySignatureDeclaration(value.parent),
        ),
        Query.collect,
      )
      const declaration = declarations[0]
      if (declaration === undefined) return Draft.empty

      const [symbol] = yield* project.symbolsAt(DECLARATION_FILE, [declaration.start])
      if (symbol === undefined) return Draft.empty
      const references = yield* Query.semanticReferences(project).pipe(
        Query.filter(({ value }) => value.node.text === OLD_NAME),
        Query.where({
          id: "resolves-to-property",
          select: (selections) =>
            Query.resolvesTo(symbol).select(
              selections.map((selection) => ({ ...selection, value: selection.value.node })),
            ),
        }),
        Query.collect,
      )
      const contextual = yield* Query.semanticReferences(project).pipe(
        Query.filter((selection) => {
          const { value } = selection
          if (value.node.text !== OLD_NAME) return false
          const parent = value.node.parent
          return (
            isPropertyAssignment(parent) ||
            isShorthandPropertyAssignment(parent) ||
            isBindingElement(parent)
          )
        }),
        Query.collect,
      )
      const selected = [
        ...new Map(
          [...references, ...contextual].map((selection) => [
            `${selection.fileName}:${selection.start}`,
            selection,
          ]),
        ).values(),
      ]

      return Draft.concat(
        ...selected.map((selection) => {
          const node = selection.value.node
          const parent = node.parent
          const nodeSelection = { ...selection, value: node }

          if (
            isBindingElement(parent) &&
            parent.name === node &&
            parent.propertyName === undefined
          ) {
            return Draft.replaceSelection(nodeSelection, `${NEW_NAME}: ${OLD_NAME}`)
          }
          if (isShorthandPropertyAssignment(parent)) {
            return Draft.replaceSelection(nodeSelection, `${NEW_NAME}: ${OLD_NAME}`)
          }
          if (
            isPropertySignatureDeclaration(parent) ||
            isPropertyAssignment(parent) ||
            (isBindingElement(parent) && parent.propertyName === node) ||
            selection.value.role === "property-name"
          ) {
            return Draft.replaceSelection(nodeSelection, NEW_NAME)
          }
          return Draft.unsupported(
            nodeSelection,
            `Account.${OLD_NAME} has an unsupported syntax shape`,
          )
        }),
        ...(yield* Query.nodes(project, isElementAccessExpression).pipe(
          Query.filter(
            ({ value }) =>
              isStringLiteral(value.argumentExpression) &&
              value.argumentExpression.text === OLD_NAME,
          ),
          Query.collect,
          Effect.map((computed) =>
            computed.map((selection) =>
              Draft.unsupported(
                selection,
                `Computed Account[${JSON.stringify(OLD_NAME)}] access requires manual review`,
              ),
            ),
          ),
        )),
      )
    }),
})
