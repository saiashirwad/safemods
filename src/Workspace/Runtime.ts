import { Context, type Path } from "effect"

interface WorkspaceDirectoryEntries {
  readonly files: ReadonlyArray<string>
  readonly directories: ReadonlyArray<string>
}

export interface WorkspaceRuntimeService extends Path.Path {
  readonly directoryEntries: (path: string) => WorkspaceDirectoryEntries | undefined
  readonly realPath: (path: string) => string | undefined
}

export class WorkspaceRuntime extends Context.Service<WorkspaceRuntime, WorkspaceRuntimeService>()(
  // oxlint-disable-next-line effecttsgo/deterministic-keys -- Stable internal service identifier.
  "@safemods/internal/WorkspaceRuntime",
) {}
