import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { relativeJsExtensions } from "../../examples/relative-js-extensions.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("relative-js-extensions", () => {
  effect(
    "prefers the compiler's directory target over an unresolved .mts candidate",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          relativeJsExtensions,
          "migration-cases/relative-js-extensions-directory-target",
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
      }),
  )

  effect(
    "names the project file a specifier reaches and reports the ones that reach none",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          relativeJsExtensions,
          "migration-cases/relative-js-extensions-unresolved",
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
        expect(verified.unsupported.map(({ fileName, message }) => [fileName, message])).toEqual([
          ["src/extra.ts", "./missing names no project file"],
        ])
      }),
  )

  effect(
    "adds .js extensions to relative import specifiers and is a no-op on rerun",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          relativeJsExtensions,
          "migrations/relative-js-extensions",
        )
        expect(verified.preview.files).toHaveLength(6)
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
        expect(verified.diagnosticDiff.unchanged.some((diagnostic) => diagnostic.code === 2322))
          .toBe(true)
      }),
  )
})
