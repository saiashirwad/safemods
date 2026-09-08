/** Workspace identity, definition, and snapshot-transition contracts. */
import { Brand, Data } from "effect"

/** A stable project identity within a Workspace. */
export type ConfiguredProject = Brand.Branded<
  { readonly id: string; readonly config: string },
  "ConfiguredProject"
>

export const ConfiguredProject = { make: Brand.nominal<ConfiguredProject>() }

export interface WorkspaceDefinition {
  readonly projects: readonly [ConfiguredProject, ...ReadonlyArray<ConfiguredProject>]
}

export interface WorkspaceFileChanges {
  readonly changed?: ReadonlyArray<string>
  readonly created?: ReadonlyArray<string>
  readonly deleted?: ReadonlyArray<string>
}

export type WorkspaceChanges = { readonly invalidateAll: true } | WorkspaceFileChanges

export interface SnapshotTransition {
  readonly changes?: WorkspaceChanges
}

export class DuplicateConfiguredProject extends Data.TaggedError("DuplicateConfiguredProject")<{
  readonly id: string
  readonly configFileName: string
}> {}

export class ProjectNotInSnapshot extends Data.TaggedError("ProjectNotInSnapshot")<{
  readonly projectId: string
  readonly generation: number
}> {}
