import type * as ProjectId from "./ProjectId.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"

export interface FileRef {
  readonly projectId: ProjectId.Type
  readonly fileName: ProjectRelativePath.Type
}

export type Map<Value> = globalThis.Map<
  ProjectId.Type,
  globalThis.Map<ProjectRelativePath.Type, Value>
>
export type ReadonlyMap<Value> = globalThis.ReadonlyMap<
  ProjectId.Type,
  globalThis.ReadonlyMap<ProjectRelativePath.Type, Value>
>

export const key = (ref: FileRef): string => `${ref.projectId}\0${ref.fileName}`

export const set = <Value>(map: Map<Value>, ref: FileRef, value: Value): void => {
  let files = map.get(ref.projectId)
  if (files === undefined) {
    files = new globalThis.Map()
    map.set(ref.projectId, files)
  }
  files.set(ref.fileName, value)
}

export function* entries<Value>(
  map: ReadonlyMap<Value>,
): Generator<readonly [FileRef, Value], void> {
  for (const [projectId, files] of map) {
    for (const [fileName, value] of files) yield [{ projectId, fileName }, value]
  }
}
