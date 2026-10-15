import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { renameInterfaceProperty } from "../../examples/rename-interface-property.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("rename-interface-property", () => {
  effect(
    "renames only semantic Account property references and reports computed access",
    () =>
      Effect.gen(function* () {
        const { verified, rerun } = yield* expectMigration(
          renameInterfaceProperty,
          "migrations/rename-interface-property",
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
        expect(verified.unsupported).toHaveLength(1)
        expect(verified.unsupported[0]?.message).toContain("Computed Account")
        expect(rerun.unsupported).toHaveLength(0)
      }),
  )
})
