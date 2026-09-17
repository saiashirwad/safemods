import { Schema } from "effect"
import * as ConfiguredProject from "./ConfiguredProject.ts"

const unique = (values: ReadonlyArray<string>): boolean => new Set(values).size === values.length

export const schema = Schema.Struct({
  projects: Schema.NonEmptyArray(ConfiguredProject.schema),
})
  .check(
    Schema.makeFilter(
      ({ projects }) =>
        unique(projects.map((project) => project.id)) &&
        unique(projects.map((project) => project.config)),
      { expected: "unique project IDs and configuration paths" },
    ),
  )
  .pipe(Schema.brand("WorkspaceDefinition"))

export type Type = typeof schema.Type

export const make = Schema.decodeEffect(schema)
