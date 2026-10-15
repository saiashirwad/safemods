import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { letToConst } from "../../examples/let-to-const.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("let-to-const", () => {
  effect("makes const only the lets whose names are never written", () =>
    Effect.gen(function* () {
      const { verified } = yield* expectMigration(letToConst, "migrations/let-to-const")
      expect(verified.diagnosticDiff).toEqual({ introduced: [], unchanged: [], resolved: [] })
    }))
})
