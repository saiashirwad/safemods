import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { removeDebugger } from "../../examples/remove-debugger.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("remove-debugger", () => {
  effect("deletes debugger statements and leaves strings alone", () =>
    Effect.gen(function* () {
      const { verified } = yield* expectMigration(removeDebugger, "migrations/remove-debugger")
      expect(verified.diagnosticDiff.introduced).toEqual([])
    }))
})
