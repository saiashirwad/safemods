import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { objectAsConst } from "../../examples/object-as-const.ts"
import { draftOf, executeRecipe } from "../utils/execute-recipe.ts"
import { fixturePath, read, withFixture } from "../utils/fixture.ts"

const fixture = "migrations/object-as-const"

describe("object-as-const", () => {
  effect(
    "adds as const to exported all-literal objects only",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const original = yield* read(fixturePath(fixture), "src/status.ts")
            const { verified } = yield* executeRecipe(objectAsConst, undefined)
            expect(verified.diagnosticDiff.introduced).toEqual([])
            expect(yield* read(root, "src/status.ts")).toBe(
              original.replace(
                'export const Status = { Pending: "pending", Done: "done" }',
                'export const Status = { Pending: "pending", Done: "done" } as const',
              ).replace(
                "export const Limits = { retries: 3, timeout: 1000 }",
                "export const Limits = { retries: 3, timeout: 1000 } as const",
              ),
            )
            expect((yield* draftOf(objectAsConst, undefined)).edits).toEqual([])
          }),
        { fixture },
      ),
  )
})
