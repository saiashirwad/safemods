import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { overloadedMethod } from "../../examples/overloaded-method.ts"
import * as Recipe from "../../src/Recipe.ts"
import { fixturePath, withFixture, read } from "../utils/fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"

const fixture = "migrations/overloaded-method"
describe("overloaded-method", () => {
  effect("migrates only the callback overload and reports spreads", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          const input = { project: app }
          const { plan, verified } = yield* executeRecipe(overloadedMethod, input)
          expect(verified.diagnosticDiff.introduced).toEqual([])
          expect(plan.unsupported).toHaveLength(1)
          expect(plan.unsupported[0]).toMatchObject({
            fileName: "src/consumer.ts",
            reason: "spread arguments prevent overload selection",
          })

          const original = yield* read(fixturePath(fixture), "src/consumer.ts")
          const actual = yield* read(root, "src/consumer.ts")
          expect(actual).toBe(
            original
              .replace(
                'client.lookup("plain", done)',
                'client.lookup("plain", {}).then((result) => done(null, result), done)',
              )
              .replace(
                'client.lookup("fresh", { fresh: true }, done)',
                'client.lookup("fresh", { fresh: true }).then((result) => done(null, result), done)',
              )
              .replace(
                'api.lookup("aliased", done)',
                'api.lookup("aliased", {}).then((result) => done(null, result), done)',
              ),
          )
          expect(actual).toContain('client.lookup("already-promise")')
          expect(actual).toContain("client.lookup(...keys, done)")
          expect(actual).toContain('unrelated.lookup("unrelated", done)')
          expect(yield* read(root, "src/lookalike.ts")).toBe(
            yield* read(fixturePath(fixture), "src/lookalike.ts"),
          )

          const second = yield* Recipe.run(overloadedMethod, input)
          expect(second.edits).toHaveLength(0)
          expect(second.unsupported).toHaveLength(1)
        }),
      { fixture },
    ),
  )
})
