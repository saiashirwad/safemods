import { Schema } from "effect"

export const schema = Schema.NonEmptyString.pipe(
  Schema.check(Schema.makeFilter((value) => !value.includes("\0"), { expected: "no NUL" })),
  Schema.brand("ProjectId"),
)

export type Type = typeof schema.Type
