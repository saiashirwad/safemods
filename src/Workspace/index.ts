export * as ConfiguredProject from "./ConfiguredProject.ts"
export * as WorkspaceDefinition from "./WorkspaceDefinition.ts"
export { WorkspaceCompilerError } from "./NativeRequest.ts"
export type { Overlay } from "./Overlay.ts"
export { NodeNotOwned, SnapshotExpired, SymbolNotFound } from "./ProjectSnapshot.ts"
export type {
  DeclarationSite,
  IntrinsicTypeName,
  ModuleExport,
  ProjectFile,
  ProjectSnapshot,
  ProjectSnapshotError,
} from "./ProjectSnapshot.ts"
export { layer, ProjectNotInSnapshot, WorkspaceService } from "./WorkspaceService.ts"
export type { WorkspaceSnapshot } from "./WorkspaceService.ts"
