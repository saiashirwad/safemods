import { Data, Effect, Schema } from "effect"

export class InvalidProjectId extends Data.TaggedError("InvalidProjectId")<{
  readonly id: string
}> {}

export const schema = Schema.NonEmptyString.pipe(
  Schema.refine((value): value is string => !value.includes("\0"), {
    identifier: "ProjectIdNoNul",
    message: "Project ID must not contain NUL",
  }),
  Schema.brand("ProjectId"),
)

export type Type = typeof schema.Type

export const make = (value: string): Effect.Effect<Type, InvalidProjectId> =>
  Schema.decodeEffect(schema)(value).pipe(
    Effect.mapError(() => new InvalidProjectId({ id: value })),
  )
