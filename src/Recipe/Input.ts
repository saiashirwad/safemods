/** Recipe input validation and durable encoding. */
import { Data, Effect, Schema } from "effect"
import type { Json } from "../Evidence/index.ts"
import type { Recipe } from "./Recipe.ts"

export class RecipeInputError extends Data.TaggedError("RecipeInputError")<{
  readonly recipe: string
  readonly cause: unknown
}> {}

export interface ValidatedRecipeInput<Input> {
  readonly value: Input
  readonly encoded: Json
}

/** Decode caller input through a recipe schema without repeating its generic cast. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Schema boundary accepts untrusted caller input.
export const decodeRecipeInput = <Input>(
  schema: Schema.Schema<Input>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Schema boundary accepts untrusted caller input.
  input: unknown,
): Effect.Effect<Input, Schema.SchemaError> => {
  // SAFETY: the schema owns the decoded Input contract.
  const decode = Schema.decodeUnknownEffect(schema) as (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decoder consumes the untrusted boundary value.
    value: unknown,
  ) => Effect.Effect<Input, Schema.SchemaError>
  return decode(input)
}

/** Encode validated recipe input to its durable JSON representation. */
export const encodeRecipeInput = <Input>(
  schema: Schema.Schema<Input>,
  input: Input,
): Effect.Effect<Json, Schema.SchemaError> => {
  // SAFETY: recipe schemas encode to the JSON representation stored in plans.
  const encode = Schema.encodeUnknownEffect(schema) as (
    value: Input,
  ) => Effect.Effect<Json, Schema.SchemaError>
  return encode(input)
}

/** Validate recipe input and encode the exact durable plan options. */
export const validateRecipeInput = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<ValidatedRecipeInput<Input>, RecipeInputError> => {
  if (recipe.schema === undefined) return Effect.succeed({ value: input, encoded: input ?? null })

  const schema = recipe.schema
  return Effect.gen(function* () {
    const value = yield* decodeRecipeInput(schema, input)
    const encoded = yield* encodeRecipeInput(schema, value)
    return { value, encoded }
  }).pipe(Effect.mapError((cause) => new RecipeInputError({ recipe: recipe.name, cause })))
}
