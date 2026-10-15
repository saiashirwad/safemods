import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { objectAsConst } from "../../examples/object-as-const.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("object-as-const", () => {
  effect("adds as const to exported all-literal objects only", () =>
    Effect.gen(function* () {
      const { verified } = yield* expectMigration(objectAsConst, "migrations/object-as-const")
      expect(verified.diagnosticDiff.introduced).toEqual([])
    }))
})
