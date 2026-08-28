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

/** Validate recipe input and encode the exact durable plan options. */
export const validateRecipeInput = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<ValidatedRecipeInput<Input>, RecipeInputError> =>
  Effect.gen(function* () {
    const schema = recipe.schema
    const candidate = input ?? null
    if (schema === undefined) {
      const encoded = yield* Schema.decodeUnknownEffect(Schema.Json)(candidate)
      return { value: input, encoded }
    }

    const value = yield* Schema.decodeUnknownEffect(schema)(input)
    const candidateEncoded = yield* Schema.encodeUnknownEffect(schema)(value)
    const encoded = yield* Schema.decodeUnknownEffect(Schema.Json)(candidateEncoded ?? null)
    return { value, encoded }
  }).pipe(Effect.mapError((cause) => new RecipeInputError({ recipe: recipe.name, cause })))
