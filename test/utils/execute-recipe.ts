import { Effect } from "effect"
import { applyVerifiedPlan } from "../../src/Application.ts"
import type { Recipe } from "../../src/Recipe.ts"
import { verify } from "../../src/Verification/index.ts"
import { Workspace } from "../../src/Workspace/index.ts"

export const executeRecipe = <Input, E, R>(recipe: Recipe<Input, E, R>, input: Input) =>
  Effect.gen(function* () {
    const verified = yield* verify(recipe, input)
    const receipt = yield* applyVerifiedPlan(verified)
    return { plan: verified.plan, verified, receipt }
  })

export const draftOf = <Input, E, R>(recipe: Recipe<Input, E, R>, input: Input) =>
  Workspace.use((workspace) => workspace.withSnapshot(recipe.run(input)))
