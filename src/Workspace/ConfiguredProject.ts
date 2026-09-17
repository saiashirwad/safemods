/** Validated identity for one configured TypeScript project. */
import { Data, Effect, Schema } from "effect"
import * as ProjectId from "../ProjectId.ts"
import * as ProjectRelativePath from "../ProjectRelativePath.ts"

export const schema = Schema.Struct({
  id: ProjectId.schema,
  config: ProjectRelativePath.schema,
})

export type Type = typeof schema.Type

export const make = (input: {
  readonly id: string
  readonly config: string
}): Effect.Effect<
  Type,
  ProjectId.InvalidProjectId | ProjectRelativePath.InvalidProjectRelativePath
> =>
  Effect.all({
    id: ProjectId.make(input.id),
    config: ProjectRelativePath.make(input.config),
  })

export class ProjectNotInSnapshot extends Data.TaggedError("ProjectNotInSnapshot")<{
  readonly projectId: ProjectId.Type
  readonly generation: number
}> {}
