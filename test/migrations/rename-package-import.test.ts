import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { renamePackageImport } from "../../examples/rename-package-import.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("rename-package-import", () => {
  effect(
    "rewrites @acme/legacy-client specifiers and leaves other modules alone",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          renamePackageImport,
          "migrations/rename-package-import",
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
        expect(verified.diagnosticDiff.unchanged.some((diagnostic) => diagnostic.code === 2322))
          .toBe(true)
      }),
  )
})
