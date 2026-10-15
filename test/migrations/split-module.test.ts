import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { splitModule, type SplitModuleInput } from "../../examples/split-module.ts"
import { expectMigration } from "../utils/expect-migration.ts"

const inputFor = (project: SplitModuleInput["project"]): SplitModuleInput => ({ project })

describe("split-module", () => {
  effect(
    "preserves inline type-only class imports and re-exports from the service",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          splitModule,
          "migration-cases/split-module-type-only-service",
          inputFor,
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
      }),
  )

  effect(
    "derives the split from the source and keeps everything else in its consumers",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          splitModule,
          "migration-cases/split-module-derived-split",
          inputFor,
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
      }),
  )

  effect("splits a mixed module and coordinates its consumers", () =>
    Effect.gen(function* () {
      const { verified, rerun } = yield* expectMigration(
        splitModule,
        "migrations/split-module",
        inputFor,
      )
      expect(verified.diagnosticDiff.introduced).toHaveLength(0)
      expect(verified.diagnosticDiff.resolved).toHaveLength(0)
      expect(rerun.fileOperations).toHaveLength(0)
    }))
})
