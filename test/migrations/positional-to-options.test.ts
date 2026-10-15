import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { positionalToOptions } from "../../examples/positional-to-options.ts"
import { expectMigration } from "../utils/expect-migration.ts"
import { fixturePath, read } from "../utils/fixture.ts"

describe("positional-to-options", () => {
  effect(
    "moves callers of every positional overload that has a matching object overload",
    () =>
      Effect.gen(function* () {
        const { verified, receipt } = yield* expectMigration(
          positionalToOptions,
          "migrations/positional-to-options",
          (project) => ({ project }),
        )
        expect(verified.diagnosticDiff.introduced).toEqual([])
        expect(verified.diagnosticDiff.unchanged.some((diagnostic) => diagnostic.code === 2322))
          .toBe(true)
        expect(new Set(verified.preview.files.map((file) => file.fileName))).toEqual(
          new Set([
            "src/auth/login.ts",
            "src/auth/refresh.ts",
            "src/http/middleware.ts",
            "src/billing/collect.ts",
          ]),
        )
        expect(receipt.written).toHaveLength(4)

        const collect = yield* read(
          fixturePath("migrations/positional-to-options"),
          "src/billing/collect.ts",
        )
        expect(verified.unsupported.map(({ start, end }) => collect.slice(start, end))).toEqual([
          "createCharge(...batch)",
        ])
      }),
  )
})
