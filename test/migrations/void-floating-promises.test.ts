import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { voidFloatingPromises } from "../../examples/void-floating-promises.ts"
import { proposalOf, executeRecipe } from "../utils/execute-recipe.ts"
import { fixturePath, read, withFixture } from "../utils/fixture.ts"

const fixture = "migrations/void-floating-promises"

describe("void-floating-promises", () => {
  effect(
    "marks only dropped promises with void",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const original = yield* read(fixturePath(fixture), "src/jobs.ts")
            const { verified } = yield* executeRecipe(voidFloatingPromises, undefined)
            expect(verified.diagnosticDiff.introduced).toEqual([])
            expect(yield* read(root, "src/jobs.ts")).toBe(
              original.replace('save("dropped")', 'void save("dropped")'),
            )
            expect((yield* proposalOf(voidFloatingPromises, undefined)).edits).toEqual([])
          }),
        { fixture },
      ),
  )
})
