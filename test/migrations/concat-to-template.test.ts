import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { concatToTemplate } from "../../examples/concat-to-template.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("concat-to-template", () => {
  effect(
    "rewrites one + between strings and numbers, and reports chains",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          concatToTemplate,
          "migrations/concat-to-template",
        )
        expect(verified.diagnosticDiff.introduced).toEqual([])
        expect(verified.unsupported.map(({ message }) => message)).toEqual([
          "a chain of + needs rewriting by hand",
        ])
      }),
  )
})
