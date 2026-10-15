import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { defaultToNamed, type DefaultToNamedInput } from "../../examples/default-to-named.ts"
import { expectMigration } from "../utils/expect-migration.ts"
import { workspacePath } from "../utils/domain.ts"

const inputFor = (project: DefaultToNamedInput["project"]): DefaultToNamedInput => ({
  project,
  declarationFile: workspacePath("src/auth/authenticate.ts"),
  exportName: "authenticate",
})

describe("default-to-named", () => {
  effect(
    "rewrites re-exports by where they resolve, not by how the specifier is spelled",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          defaultToNamed,
          "migration-cases/default-to-named-reexports",
          inputFor,
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
      }),
  )

  effect(
    "converts authenticate from a default export to a named export",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          defaultToNamed,
          "migrations/default-to-named",
          inputFor,
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
      }),
  )
})
