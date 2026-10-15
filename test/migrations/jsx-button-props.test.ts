import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { jsxButtonProps } from "../../examples/jsx-button-props.ts"
import { expectMigration } from "../utils/expect-migration.ts"

describe("jsx-button-props", () => {
  effect("migrates only safe props on the canonical component", () =>
    Effect.gen(function* () {
      const { verified, receipt, rerun } = yield* expectMigration(
        jsxButtonProps,
        "migrations/jsx-button-props",
      )
      expect(verified.diagnosticDiff.introduced).toEqual([])
      expect(receipt.written).toHaveLength(2)
      expect(verified.unsupported.map(({ message }) => message)).toEqual([
        "oldLabel: duplicate label prop",
        "oldLabel: JSX spread may contain label",
        "oldLabel: JSX spread may contain label",
        "compact: duplicate size prop",
      ])
      expect(rerun.unsupported).toHaveLength(4)
    }))
})
