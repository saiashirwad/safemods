import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { normalizeLineEndings } from "../../examples/normalize-line-endings.ts"
import { draftOf, executeRecipe } from "../utils/execute-recipe.ts"
import { read, withFixture } from "../utils/fixture.ts"

describe("normalize-line-endings", () => {
  effect(
    "rewrites only the files with CRLF endings",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const { receipt } = yield* executeRecipe(normalizeLineEndings, undefined)
            expect(receipt.written.map((file) => file.fileName)).toEqual(["src/windows.ts"])
            expect(yield* read(root, "src/windows.ts")).toBe(
              "export const first = 1\nexport const second = 2\n",
            )
            expect((yield* draftOf(normalizeLineEndings, undefined)).edits).toEqual([])
          }),
        { fixture: "migrations/normalize-line-endings" },
      ),
  )
})
