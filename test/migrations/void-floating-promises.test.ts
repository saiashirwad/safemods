import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { voidFloatingPromises } from "../../examples/void-floating-promises.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("void-floating-promises", () => {
  effect("marks only dropped promises with void", () =>
    Effect.gen(function* () {
      const { verified } = yield* expectMigration(
        voidFloatingPromises,
        "migrations/void-floating-promises",
      )
      expect(verified.diagnosticDiff.introduced).toEqual([])
    }))
})
