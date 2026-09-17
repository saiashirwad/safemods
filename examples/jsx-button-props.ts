/**
 * Migrate legacy props on the canonical `Button` component. Direct, aliased,
 * and namespace JSX references are resolved by the checker. Ambiguous spreads
 * and duplicate target props are reported instead of being rewritten.
 */
import { Effect } from "effect"
import type { JsxAttribute, JsxOpeningLikeElement } from "typescript/unstable/ast"
import {
  isIdentifier,
  isJsxAttribute,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isPropertyAccessExpression,
} from "typescript/unstable/ast/is"
import { concat, replace, unsupported, type Draft } from "safemods/Draft"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const componentFile = ProjectRelativePath.schema.make("src/ui/button.tsx")
const isOpeningLike = (
  node: Parameters<typeof isJsxOpeningElement>[0],
): node is JsxOpeningLikeElement => isJsxOpeningElement(node) || isJsxSelfClosingElement(node)

const attributeNamed = (element: JsxOpeningLikeElement, name: string): JsxAttribute | undefined =>
  element.attributes.properties.find(
    (property): property is JsxAttribute =>
      isJsxAttribute(property) && isIdentifier(property.name) && property.name.text === name,
  )

export const jsxButtonProps = Recipe.define("jsx-button-props", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = snapshot.projects[0]!
      const button = yield* project.symbolNamed("Button", { within: componentFile })
      const matches = yield* Query.nodes(project, isOpeningLike).pipe(
        Query.where(
          Query.resolvesTo(button, {
            location: (element) =>
              isPropertyAccessExpression(element.tagName) ? element.tagName.name : element.tagName,
          }),
        ),
        Query.collect,
      )

      return concat(
        ...matches.flatMap((selection) => {
          const element = selection.value
          const hasSpread = element.attributes.properties.some(
            (property) => !isJsxAttribute(property),
          )
          const drafts: Array<Draft> = []
          for (const [oldName, newName] of [
            ["oldLabel", "label"],
            ["compact", "size"],
          ] as const) {
            const oldAttribute = attributeNamed(element, oldName)
            if (oldAttribute === undefined) continue
            if (hasSpread) {
              drafts.push(unsupported(selection, `${oldName}: JSX spread may contain ${newName}`))
            } else if (attributeNamed(element, newName) !== undefined) {
              drafts.push(unsupported(selection, `${oldName}: duplicate ${newName} prop`))
            } else {
              drafts.push(replace(project, oldAttribute.name, newName))
            }
          }
          return drafts
        }),
      )
    }),
})
