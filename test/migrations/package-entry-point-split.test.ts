import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { packageEntryPointSplit } from "../../examples/package-entry-point-split.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("package-entry-point-split", () => {
  effect(
    "moves unambiguous imports and exports while reporting declarations needing a choice",
    () =>
      Effect.gen(function* () {
        const { verified, rerun } = yield* expectMigration(
          packageEntryPointSplit,
          "migrations/package-entry-point-split",
        )
        expect(verified.unsupported).toHaveLength(5)
        expect(verified.preview.files).toHaveLength(4)
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
        expect(verified.diagnosticDiff.unchanged.some((diagnostic) => diagnostic.code === 2322))
          .toBe(true)

        const reasons = verified.unsupported.map(({ message }) => message)
        expect(reasons).toContain(
          "This declaration mixes exports from different package entry points",
        )
        expect(reasons).toContain(
          "The root entry point is ambiguous here; choose @acme/sdk/auth or @acme/sdk/billing manually",
        )
        expect(rerun.unsupported).toHaveLength(5)
      }),
  )
})
