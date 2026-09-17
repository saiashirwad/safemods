import { describe, effect, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as Draft from "../src/Draft/index.ts"
import { PlanBuildError } from "../src/Plan.ts"
import { RecipeInputError } from "../src/Recipe.ts"
import * as Recipe from "../src/Recipe.ts"
import { withFixture } from "./utils/declarative-fixture.ts"

describe("recipe definition and input validation", () => {
  effect(
    "validates recipe inputs with Effect Schema",
    () =>
      withFixture((_, _app) =>
        Effect.gen(function* () {
          const schemaRecipe = Recipe.define("schema-recipe", {
            version: "1.0.0",
            schema: Schema.Struct({
              propertyName: Schema.NonEmptyString,
              multiplier: Schema.Finite,
            }),
            run: (input) =>
              Effect.sync(() => {
                expect(input.propertyName).toBe("validProp")
                expect(input.multiplier).toBe(42)
                return Draft.empty
              }),
          })

          yield* Recipe.run(schemaRecipe, { propertyName: "validProp", multiplier: 42 })

          // SAFETY: the test intentionally provides invalid input to verify runtime schema validation.
          const failure = yield* Recipe.run(schemaRecipe, {
            propertyName: "",
            multiplier: 42,
          } as any).pipe(Effect.flip)
          expect(failure).toBeInstanceOf(RecipeInputError)
        }),
      ),
    60_000,
  )

  effect(
    "rejects unsatisfiable or non-finite policy bounds when the plan is built",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          for (const policies of [
            { matchCount: { min: 4, max: 3 } },
            { matchCount: { min: -1 } },
            { matchCount: { max: 1.5 } },
            { maxAffectedFiles: Infinity },
          ]) {
            const recipe = Recipe.define("bad-bounds", {
              version: "1.0.0",
              policies,
              run: () => Effect.succeed(Draft.empty),
            })
            const failure = yield* Recipe.run(recipe, undefined).pipe(Effect.flip)
            expect(failure).toBeInstanceOf(PlanBuildError)
          }
        }),
      ),
    60_000,
  )
})
