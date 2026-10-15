import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { asAssertionToSatisfies } from "../../examples/as-assertion-to-satisfies.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("as-assertion-to-satisfies", () => {
  effect(
    "rewrites only safe contextual assertions and preserves narrower inference",
    () =>
      Effect.gen(function* () {
        const { verified, rerun } = yield* expectMigration(
          asAssertionToSatisfies,
          "migrations/as-assertion-to-satisfies",
        )
        expect(verified.unsupported.map(({ message }) => message).sort()).toEqual([
          "chained assertion requires manual review",
          "const assertion is not a type conformance check",
          "parenthesized assertion requires manual review",
        ])
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
        expect(rerun.unsupported).toHaveLength(3)
      }),
  )
})
