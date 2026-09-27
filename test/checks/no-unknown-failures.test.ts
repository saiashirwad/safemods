import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { noUnknownFailures } from "../../examples/no-unknown-failures.ts"
import { findingsOf } from "../utils/check.ts"

describe("no-unknown-failures", () => {
  effect(
    "reports Effect, Stream and Layer calls that can fail with unknown",
    () =>
      Effect.gen(function* () {
        const findings = yield* findingsOf(
          noUnknownFailures({ within: "src/**" }),
          {
            "src/failures.ts": [
              'import { Context, Effect, Layer, Stream } from "effect"',
              'class Clock extends Context.Service<Clock, { readonly now: number }>()("app/Clock") {}',
              "declare const cause: unknown",
              "export const effect = Effect.fail(cause)",
              "export const stream = Stream.fail(cause)",
              "export const layer = Layer.effect(Clock, Effect.fail(cause))",
              'export const typed = Effect.fail(new Error("typed"))',
              "export const fine = Effect.succeed(1)",
              "",
            ].join("\n"),
          },
          { dependencies: true },
        )
        expect(findings).toEqual([
          "src/failures.ts:4:23 no-unknown-failures returns an Effect that can fail with unknown: give the failure a type",
          "src/failures.ts:5:23 no-unknown-failures returns a Stream that can fail with unknown: give the failure a type",
          "src/failures.ts:6:22 no-unknown-failures returns a Layer that can fail with unknown: give the failure a type",
          "src/failures.ts:6:42 no-unknown-failures returns an Effect that can fail with unknown: give the failure a type",
        ])
      }),
    { timeout: 60_000 },
  )
})
