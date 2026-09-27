import { Data, Effect, Schema } from "effect"
import type { Draft } from "./Draft.ts"
import type { PlanPolicies } from "./Plan.ts"
import type { WorkspaceSnapshot } from "./Workspace/index.ts"

export interface Recipe<Input = undefined, E = never, R = never> {
  readonly name: string
  readonly version: string
  readonly policies: PlanPolicies
  readonly schema: Schema.Codec<Input, unknown> | undefined
  readonly run: (input: Input) => Effect.Effect<Draft, E, R | WorkspaceSnapshot>
}

export class RecipeInputError extends Data.TaggedError("RecipeInputError")<{
  readonly recipe: string
  readonly cause: unknown
}> {}

export const define = <Input = undefined, E = never, R = never>(
  name: string,
  definition: {
    readonly version: string
    readonly schema?: Schema.Codec<Input, unknown>
    readonly policies?: Partial<PlanPolicies>
    readonly run: (input: Input) => Effect.Effect<Draft, E, R | WorkspaceSnapshot>
  },
): Recipe<Input, E, R> => ({
  name,
  version: definition.version,
  schema: definition.schema,
  policies: {
    diagnostics: "no-new-errors",
    idempotence: "not-promised",
    ...definition.policies,
  },
  run: definition.run,
})

export const checkInput = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<void, RecipeInputError> =>
  recipe.schema === undefined ?
    Effect.void :
    Schema.encodeUnknownEffect(recipe.schema)(input).pipe(
      Effect.asVoid,
      Effect.mapError((cause) => new RecipeInputError({ recipe: recipe.name, cause })),
    )
