import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { moveModule } from "../../examples/move-module.ts"
import { expectMigration } from "../utils/expect-migration.ts"
import { workspacePath } from "../utils/domain.ts"

describe("move-module", () => {
  effect(
    "asks the compiler which specifiers reach the moved file, whatever its extension",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          moveModule,
          "migration-cases/move-module-mts",
          (project) => ({
            project,
            from: workspacePath("src/tools/clock.mts"),
            to: workspacePath("src/shared/clock.mts"),
          }),
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
      }),
  )

  effect(
    "moves src/users/account.ts and rewrites relative importers",
    () =>
      Effect.gen(function* () {
        const { verified, rerun } = yield* expectMigration(
          moveModule,
          "migrations/move-module",
          (project) => ({
            project,
            from: workspacePath("src/users/account.ts"),
            to: workspacePath("src/identity/account.ts"),
          }),
        )
        expect(verified.preview.files.find((file) => file.movedFrom !== undefined)).toMatchObject({
          movedFrom: "src/users/account.ts",
          fileName: "src/identity/account.ts",
        })
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
        expect(rerun.fileOperations).toHaveLength(0)
      }),
  )
})
