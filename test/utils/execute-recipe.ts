import { Effect } from "effect"
import { applyVerifiedPlan } from "../../src/Application.ts"
import { run, type Recipe } from "../../src/Recipe/index.ts"
import { verify } from "../../src/Verification/index.ts"

/** Test helper: run, verify, and apply a recipe in one step. */
export const executeRecipe = <Input, E, R>(recipe: Recipe<Input, E, R>, input: Input) =>
  Effect.gen(function* () {
    const plan = yield* run(recipe, input)
    const verified = yield* verify(plan, recipe, input)
    const receipt = yield* applyVerifiedPlan(verified)
    return { plan, verified, receipt }
  })
