import { Schema } from "effect"
import * as ProjectId from "../ProjectId.ts"
import * as ProjectRelativePath from "../ProjectRelativePath.ts"

export const schema = Schema.Struct({
  id: ProjectId.schema,
  config: ProjectRelativePath.schema,
})

export type Type = typeof schema.Type
