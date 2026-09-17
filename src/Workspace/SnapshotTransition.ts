export interface WorkspaceFileChanges {
  readonly changed?: ReadonlyArray<string>
  readonly created?: ReadonlyArray<string>
  readonly deleted?: ReadonlyArray<string>
}

export interface SnapshotTransition {
  readonly changes?: WorkspaceFileChanges
}
