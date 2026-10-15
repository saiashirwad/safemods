import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { overloadedMethod } from "../../examples/overloaded-method.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("overloaded-method", () => {
  effect("migrates only the callback overload and reports spreads", () =>
    Effect.gen(function* () {
      const { verified, rerun } = yield* expectMigration(
        overloadedMethod,
        "migrations/overloaded-method",
        (project) => ({ project }),
      )
      expect(verified.diagnosticDiff.introduced).toEqual([])
      expect(verified.unsupported).toHaveLength(1)
      expect(verified.unsupported[0]).toMatchObject({
        fileName: "src/consumer.ts",
        message: "spread arguments prevent overload selection",
      })
      expect(rerun.unsupported).toHaveLength(1)
    }))
})
