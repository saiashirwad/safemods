import type * as ProjectId from "./ProjectId.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"

export interface FileRef {
  readonly projectId: ProjectId.Type
  readonly fileName: ProjectRelativePath.Type
}

export const key = (ref: FileRef): string => `${ref.projectId}\0${ref.fileName}`
