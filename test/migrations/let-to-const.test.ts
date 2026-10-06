import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { letToConst } from "../../examples/let-to-const.ts"
import { proposalOf, executeRecipe } from "../utils/execute-recipe.ts"
import { fixturePath, read, withFixture } from "../utils/fixture.ts"

const fixture = "migrations/let-to-const"

describe("let-to-const", () => {
  effect(
    "makes const only the lets whose names are never written",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const original = yield* read(fixturePath(fixture), "src/summary.ts")
            const { verified } = yield* executeRecipe(letToConst, undefined)
            expect(verified.diagnosticDiff).toEqual({ introduced: [], unchanged: [], resolved: [] })
            expect(yield* read(root, "src/summary.ts")).toBe(
              original.replace("let count = values.length", "const count = values.length").replace(
                "let [first, second] = values",
                "const [first, second] = values",
              ).replace("for (let name of list)", "for (const name of list)").replace(
                "let fallback = 1",
                "const fallback = 1",
              ),
            )
            expect((yield* proposalOf(letToConst, undefined)).edits).toEqual([])
          }),
        { fixture },
      ),
  )
})
