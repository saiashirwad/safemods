import { describe, effect, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as Draft from "../src/Draft.ts"
import { PlanBuildError } from "../src/Plan.ts"
import * as Recipe from "../src/Recipe.ts"
import { withFixture } from "./utils/fixture.ts"

describe("recipe planning", () => {
  effect(
    "validates input through the recipe schema and records its encoded form",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          const received: Array<{ readonly name: string; readonly count: number }> = []
          const recipe = Recipe.define("schema-recipe", {
            version: "1.0.0",
            schema: Schema.Struct({ name: Schema.NonEmptyString, count: Schema.FiniteFromString }),
            run: (input) =>
              Effect.sync(() => {
                received.push(input)
                return Draft.empty
              }),
          })

          const plan = yield* Recipe.run(recipe, { name: "valid", count: 42 })
          expect(received).toEqual([{ name: "valid", count: 42 }])
          expect(plan.recipe.options).toEqual({ name: "valid", count: "42" })

          const failure = yield* Effect.flip(Recipe.run(recipe, { name: "", count: 42 }))
          expect(failure).toBeInstanceOf(Recipe.RecipeInputError)
        }),
      ),
    60_000,
  )

  effect(
    "rejects unsatisfiable or non-finite policy bounds when the plan is built",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          for (const policies of [{ maxAffectedFiles: Infinity }]) {
            const recipe = Recipe.define("bad-bounds", {
              version: "1.0.0",
              policies,
              run: () => Effect.succeed(Draft.empty),
            })
            expect(yield* Effect.flip(Recipe.run(recipe, undefined))).toBeInstanceOf(PlanBuildError)
          }
        }),
      ),
    60_000,
  )
})
