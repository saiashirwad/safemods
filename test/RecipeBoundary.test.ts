import { describe, effect, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { Proposal, Recipe } from "../src/index.ts"

describe("recipe boundary", () => {
  effect("checks decoded inputs using the schema's encoding side", () =>
    Effect.gen(function* () {
      const recipe = Recipe.define("count", {
        version: "1.0.0",
        schema: Schema.FiniteFromString,
        run: (_snapshot, _count) => Effect.succeed(Proposal.empty),
      })
      yield* Recipe.checkInput(recipe, 42)
      const invalid = yield* Effect.flip(Recipe.checkInput(recipe, NaN))
      expect(invalid).toBeInstanceOf(Recipe.RecipeInputError)
    }))

  effect(
    "rejects malformed metadata and policies before executing a recipe",
    () =>
      Effect.gen(function* () {
        const definition = { version: "1.0.0", run: () => Effect.succeed(Proposal.empty) }
        for (
          const recipe of [
            Recipe.define("", definition),
            Recipe.define("bad-version", { ...definition, version: " " }),
            ...[NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((maxAffectedFiles) =>
              Recipe.define("bad-budget", { ...definition, policies: { maxAffectedFiles } })
            ),
          ]
        ) {
          expect(yield* Effect.flip(Recipe.checkInput(recipe, undefined))).toBeInstanceOf(
            Recipe.RecipeInputError,
          )
        }
        expect(Recipe.isRecipe({ ...Recipe.define("valid", definition), schema: {} })).toBe(false)
      }),
  )
})
