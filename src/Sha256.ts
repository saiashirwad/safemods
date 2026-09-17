import { hash } from "node:crypto"
import { Schema } from "effect"

export const schema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("Sha256"),
)

export type Type = typeof schema.Type

export const digest = (content: string): Type => schema.make(hash("sha256", content, "hex"))
