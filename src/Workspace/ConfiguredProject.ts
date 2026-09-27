import { Schema } from "effect"
import * as ProjectId from "../ProjectId.ts"
import * as WorkspacePath from "../WorkspacePath.ts"

export const schema = Schema.Struct({
  id: ProjectId.schema,
  config: WorkspacePath.schema,
})

export type Type = typeof schema.Type
