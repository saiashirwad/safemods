import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { renameThroughBarrel } from "../../examples/rename-through-barrel.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("rename-through-barrel", () => {
  effect(
    "renames loadAccount through barrels and aliases without touching a different loadAccount",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          renameThroughBarrel,
          "migrations/rename-through-barrel",
        )
        expect(verified.preview.files).toHaveLength(4)
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
      }),
  )
})
