import { hash } from "node:crypto"
import { Data, Effect, Schema } from "effect"

export class InvalidSha256 extends Data.TaggedError("InvalidSha256")<{
  readonly value: string
}> {}

export const schema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("Sha256"),
)

export type Type = typeof schema.Type

export const make = (value: string): Effect.Effect<Type, InvalidSha256> =>
  Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => new InvalidSha256({ value })))

export const digest = (content: string): Type => schema.make(hash("sha256", content, "hex"))
