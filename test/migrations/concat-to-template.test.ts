import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { concatToTemplate } from "../../examples/concat-to-template.ts"
import { draftOf, executeRecipe } from "../utils/execute-recipe.ts"
import { fixturePath, read, withFixture } from "../utils/fixture.ts"

const fixture = "migrations/concat-to-template"

describe("concat-to-template", () => {
  effect(
    "rewrites one + between strings and numbers, and reports chains",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const original = yield* read(fixturePath(fixture), "src/greeting.ts")
            const { plan, verified } = yield* executeRecipe(concatToTemplate, undefined)
            expect(verified.diagnosticDiff.introduced).toEqual([])
            expect(plan.unsupported.map(({ message }) => message)).toEqual([
              "a chain of + needs rewriting by hand",
            ])
            expect(yield* read(root, "src/greeting.ts")).toBe(
              original.replace('"Hello " + name', "`Hello ${name}`").replace(
                'age + " years"',
                "`${age} years`",
              ).replace('"`" + name', "`\\`${name}`"),
            )
            expect((yield* draftOf(concatToTemplate, undefined)).edits).toEqual([])
          }),
        { fixture },
      ),
  )
})
