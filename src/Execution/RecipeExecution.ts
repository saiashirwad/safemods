import { Effect } from "effect"
import { applyVerifiedPlan } from "../Application/index.ts"
import { run, type Recipe } from "../Recipe/index.ts"
import { verify } from "../Verification/index.ts"

/**
 * Run, verify, and apply a recipe. Call the three stages directly when a
 * caller needs to stop between them.
 */
export const executeRecipe = <Input, E, R>(recipe: Recipe<Input, E, R>, input: Input) =>
  Effect.gen(function* () {
    const plan = yield* run(recipe, input)
    const verified = yield* verify(plan, recipe, input)
    const receipt = yield* applyVerifiedPlan(verified)
    return { plan, verified, receipt }
  })
