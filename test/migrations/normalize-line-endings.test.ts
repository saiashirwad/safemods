import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { normalizeLineEndings } from "../../examples/normalize-line-endings.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("normalize-line-endings", () => {
  effect("rewrites only the files with CRLF endings", () =>
    Effect.gen(function* () {
      const { receipt } = yield* expectMigration(
        normalizeLineEndings,
        "migrations/normalize-line-endings",
      )
      expect(receipt.written.map((file) => file.fileName)).toEqual(["src/windows.ts"])
    }))
})
