import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { removeDebugger } from "../../examples/remove-debugger.ts"
import { proposalOf, executeRecipe } from "../utils/execute-recipe.ts"
import { read, withFixture } from "../utils/fixture.ts"

const fixture = "migrations/remove-debugger"

describe("remove-debugger", () => {
  effect(
    "deletes debugger statements and leaves strings alone",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const { verified } = yield* executeRecipe(removeDebugger, undefined)
            expect(verified.diagnosticDiff.introduced).toEqual([])
            expect(yield* read(root, "src/total.ts")).toBe(
              `export function total(values: ReadonlyArray<number>): number {
  let sum = 0
  for (const value of values) {
    
    sum += value
  }
  
  return sum
}

export const note = "a debugger in a string stays"
`,
            )
            expect((yield* proposalOf(removeDebugger, undefined)).edits).toEqual([])
          }),
        { fixture },
      ),
  )
})
