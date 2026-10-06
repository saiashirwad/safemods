/**
 * Migrate legacy props on the canonical `Button` component. Direct, aliased,
 * and namespace JSX references are resolved by the checker. Ambiguous spreads
 * and duplicate target props are reported instead of being rewritten.
 */
import { Proposal, Pattern as P, WorkspacePath, Query, Recipe } from "safemods"
import { Effect } from "effect"
import type { Identifier, JsxOpeningLikeElement, Node } from "typescript/unstable/ast"
import {
  isIdentifier,
  isJsxAttribute,
  isJsxOpeningLikeElement,
  isJsxSpreadAttribute,
  isPropertyAccessExpression,
} from "typescript/unstable/ast/is"

const componentFile = WorkspacePath.schema.make("src/ui/button.tsx")

const renames = [
  ["oldLabel", "label"],
  ["compact", "size"],
] as const

const attributeNamed = (text: string) =>
  P.node(isJsxAttribute, { name: P.bind("name", P.node(isIdentifier, { text })) })

const propNamed = (element: JsxOpeningLikeElement, text: string): Identifier | undefined => {
  const pattern = attributeNamed(text)
  return element.attributes.properties
    .map((property) => pattern.match(property)?.name)
    .find((name) => name !== undefined)
}

const hasSpread = (element: JsxOpeningLikeElement): boolean =>
  element.attributes.properties.some(isJsxSpreadAttribute)

const tagIdentifier = (element: JsxOpeningLikeElement): Node =>
  isPropertyAccessExpression(element.tagName) ? element.tagName.name : element.tagName

const renameProp = (
  selection: Query.Selection<JsxOpeningLikeElement>,
  [from, to]: readonly [string, string],
): Proposal.Proposal => {
  const element = selection.value
  const prop = propNamed(element, from)
  if (prop === undefined) return Proposal.empty
  if (hasSpread(element)) {
    return Proposal.unsupported(selection, `${from}: JSX spread may contain ${to}`)
  }
  if (propNamed(element, to) !== undefined) {
    return Proposal.unsupported(selection, `${from}: duplicate ${to} prop`)
  }
  return Proposal.replace(selection.project, prop, to)
}

export const jsxButtonProps = Recipe.define("jsx-button-props", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (snapshot) =>
    Effect.gen(function* () {
      const project = snapshot.projects[0]!
      const button = yield* project.symbolNamed("Button", { within: componentFile })
      const elements = yield* Query.nodes(project, isJsxOpeningLikeElement).pipe(
        Query.where(Query.resolvesTo(button, { location: tagIdentifier })),
      )

      return Proposal.concat(
        ...elements.flatMap((element) => renames.map((rename) => renameProp(element, rename))),
      )
    }),
})

export default jsxButtonProps
