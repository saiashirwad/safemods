/** A non-empty set of configured projects with unique identities and configuration paths. */
import { Data, Effect, Schema } from "effect"
import type * as ProjectId from "../ProjectId.ts"
import type * as ProjectRelativePath from "../ProjectRelativePath.ts"
import * as ConfiguredProject from "./ConfiguredProject.ts"

export class DuplicateConfiguredProject extends Data.TaggedError("DuplicateConfiguredProject")<{
  readonly id: ProjectId.Type
  readonly config: ProjectRelativePath.Type
}> {}

const duplicate = (
  projects: ReadonlyArray<ConfiguredProject.Type>,
): ConfiguredProject.Type | undefined => {
  const ids = new Set<ProjectId.Type>()
  const configs = new Set<ProjectRelativePath.Type>()
  for (const project of projects) {
    if (ids.has(project.id) || configs.has(project.config)) return project
    ids.add(project.id)
    configs.add(project.config)
  }
  return undefined
}

export const schema = Schema.Struct({
  projects: Schema.NonEmptyArray(ConfiguredProject.schema),
})
  .check(
    Schema.makeFilter((definition) => duplicate(definition.projects) === undefined, {
      expected: "unique project IDs and configuration paths",
    }),
  )
  .pipe(Schema.brand("WorkspaceDefinition"))

export type Type = typeof schema.Type

export const make = (input: {
  readonly projects: readonly [ConfiguredProject.Type, ...ReadonlyArray<ConfiguredProject.Type>]
}): Effect.Effect<Type, DuplicateConfiguredProject> => {
  const repeated = duplicate(input.projects)
  return repeated === undefined
    ? Effect.succeed(schema.make(input))
    : Effect.fail(
        new DuplicateConfiguredProject({
          id: repeated.id,
          config: repeated.config,
        }),
      )
}
