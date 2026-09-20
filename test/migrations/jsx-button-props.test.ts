import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { jsxButtonProps } from "../../examples/jsx-button-props.ts"
import * as Recipe from "../../src/Recipe.ts"
import { fixturePath as fixtureDirectory, withFixture, read as readUtf8 } from "../utils/fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"

const fixture = "migrations/jsx-button-props"
const fixturePath = fixtureDirectory(fixture)
describe("jsx-button-props", () => {
  effect("migrates only safe props on the canonical component", () =>
    withFixture(
      (root) =>
        Effect.gen(function* () {
          const { plan, verified, receipt } = yield* executeRecipe(jsxButtonProps, undefined)

          expect(plan.recipe.name).toBe("jsx-button-props")
          expect(verified.diagnosticDiff.introduced).toEqual([])
          expect(receipt.written).toHaveLength(2)
          expect(plan.unsupported.map(({ reason }) => reason)).toEqual([
            "oldLabel: duplicate label prop",
            "oldLabel: JSX spread may contain label",
            "oldLabel: JSX spread may contain label",
            "compact: duplicate size prop",
          ])

          const actions = yield* readUtf8(root, "src/features/actions.tsx")
          expect(actions).toContain('<Button label="Save" size />')
          expect(actions).toContain('<ActionButton label="Cancel" size={false} />')
          expect(actions).toContain('<UI.Button label="Delete" />')
          expect(actions).toContain('<Button label="Current" oldLabel="Legacy" />')
          expect(actions).toContain('<Button {...forwarded} oldLabel="After spread" />')
          expect(actions).toContain('<Button oldLabel="Before spread" {...forwarded} />')
          expect(actions).toContain('<Button size="large" compact />')

          const diagnostic = yield* readUtf8(root, "src/features/preexisting-error.tsx")
          expect(diagnostic).toContain("<Button label={123} />")

          for (const relative of [
            "src/ui/button.tsx",
            "src/ui/index.tsx",
            "src/features/unrelated.tsx",
          ]) {
            const [actual, original] = yield* Effect.all([
              readUtf8(root, relative),
              readUtf8(fixturePath, relative),
            ])
            expect(actual).toBe(original)
          }

          const second = yield* Recipe.run(jsxButtonProps, undefined)
          expect(second.edits).toHaveLength(0)
          expect(second.unsupported).toHaveLength(4)
        }),
      { fixture },
    ),
  )
})
