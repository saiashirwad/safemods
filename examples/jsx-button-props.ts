/**
 * Migrate legacy props on the canonical `Button` component. Direct, aliased,
 * and namespace JSX references are resolved by the checker. Ambiguous spreads
 * and duplicate target props are reported instead of being rewritten.
 */
import { Effect } from "effect"
import type { Identifier, JsxOpeningLikeElement, Node } from "typescript/unstable/ast"
import {
  isIdentifier,
  isJsxAttribute,
  isJsxOpeningLikeElement,
  isJsxSpreadAttribute,
  isPropertyAccessExpression,
} from "typescript/unstable/ast/is"
import { concat, empty, replace, unsupported, type Draft } from "safemods/Draft"
import * as P from "safemods/Pattern"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const componentFile = ProjectRelativePath.schema.make("src/ui/button.tsx")

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
): Draft => {
  const element = selection.value
  const prop = propNamed(element, from)
  if (prop === undefined) return empty
  if (hasSpread(element)) return unsupported(selection, `${from}: JSX spread may contain ${to}`)
  if (propNamed(element, to) !== undefined) {
    return unsupported(selection, `${from}: duplicate ${to} prop`)
  }
  return replace(selection.project, prop, to)
}

export const jsxButtonProps = Recipe.define("jsx-button-props", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = snapshot.projects[0]!
      const button = yield* project.symbolNamed("Button", { within: componentFile })
      const elements = yield* Query.nodes(project, isJsxOpeningLikeElement).pipe(
        Query.where(Query.resolvesTo(button, { location: tagIdentifier })),
        Query.collect,
      )

      return concat(
        ...elements.flatMap((element) => renames.map((rename) => renameProp(element, rename))),
      )
    }),
})
