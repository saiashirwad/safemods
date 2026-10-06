import { Effect } from "effect"
import type { Recipe } from "../../src/Recipe.ts"
import { verify } from "../../src/Migration/index.ts"
import { Workspace } from "../../src/Workspace/index.ts"

export const executeRecipe = <Input, E, R>(recipe: Recipe<Input, E, R>, input: Input) =>
  Effect.gen(function* () {
    const verified = yield* verify(recipe, input)
    const receipt = yield* verified.apply
    return { verified, receipt }
  })

export const proposalOf = <Input, E, R>(recipe: Recipe<Input, E, R>, input: Input) =>
  Workspace.use((workspace) => workspace.withSnapshot((snapshot) => recipe.run(snapshot, input)))
