/** Public assembly for Workspace values, snapshot regions, and services. */
export {
  ConfiguredProject,
  DuplicateConfiguredProject,
  ProjectNotInSnapshot,
} from "./ConfiguredProject.ts"
export type {
  SnapshotTransition,
  WorkspaceChanges,
  WorkspaceDefinition,
} from "./ConfiguredProject.ts"
export {
  FileNotFound,
  isProjectFile,
  ProjectFileTypeSymbol,
  SnapshotExpired,
  SymbolNotFound,
  WorkspaceCompilerError,
} from "./ProjectSnapshot.ts"
export type { ProjectFile, ProjectSnapshot, ProjectSnapshotError } from "./ProjectSnapshot.ts"
export { WorkspaceSnapshot } from "./SnapshotRegion.ts"
export type { WorkspaceSnapshotService } from "./SnapshotRegion.ts"
export { WorkspaceRuntime } from "./Runtime.ts"
export type { WorkspaceDirectoryEntries, WorkspaceRuntimeService } from "./Runtime.ts"
export { Workspace } from "./Service.ts"
export type { WorkspaceService } from "./Service.ts"
