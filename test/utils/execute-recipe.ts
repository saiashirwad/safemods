import { Effect } from "effect"
import type * as Recipe from "../../src/Recipe.ts"
import { verify } from "../../src/Migration/index.ts"
import { WorkspaceService } from "../../src/Workspace/index.ts"

export const executeRecipe = <Input, E, R>(recipe: Recipe.Definition<Input, E, R>, input: Input) =>
  Effect.gen(function* () {
    const verified = yield* verify(recipe, input)
    const receipt = yield* verified.apply
    return { verified, receipt }
  })

export const proposalOf = <Input, E, R>(recipe: Recipe.Definition<Input, E, R>, input: Input) =>
  WorkspaceService.use((workspace) =>
    workspace.withSnapshot((snapshot) => recipe.run(snapshot, input))
  )
