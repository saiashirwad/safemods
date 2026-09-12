/** Native compiler filesystem options for an isolated virtual snapshot. */
import type { Types } from "effect"
import type { APIOptions } from "typescript/unstable/async"
import { isPathContained } from "../../ProjectPath.ts"
import type { VirtualFsSnapshot } from "../../VirtualFs.ts"
import type { SnapshotTransition, WorkspaceFileChanges } from "../SnapshotTransition.ts"
import type { WorkspaceRuntimeService } from "../Runtime.ts"

interface CompilerOverlay {
  readonly options: APIOptions
  readonly transition: SnapshotTransition
}

export const compilerOverlayFor = (
  runtime: WorkspaceRuntimeService,
  apiOptions: APIOptions,
  overlay: VirtualFsSnapshot,
): CompilerOverlay => {
  const resolvedFiles = new Map<string, string>()
  for (const [fileName, content] of overlay.files) {
    resolvedFiles.set(runtime.resolve(fileName), content)
  }
  const resolvedCreated = new Set<string>()
  for (const fileName of overlay.created) {
    resolvedCreated.add(runtime.resolve(fileName))
  }
  const resolvedDeleted = new Set<string>()
  for (const fileName of overlay.deleted) {
    resolvedDeleted.add(runtime.resolve(fileName))
  }

  const options: APIOptions = {
    ...apiOptions,
    fs: {
      ...apiOptions.fs,
      getAccessibleEntries: (directoryName) => {
        const list = apiOptions.fs?.getAccessibleEntries
        const existing =
          list !== undefined ? list(directoryName) : runtime.directoryEntries(directoryName)
        const isDeleted = (entry: string) =>
          resolvedDeleted.has(runtime.resolve(directoryName, entry))
        const files = new Set((existing?.files ?? []).filter((entry) => !isDeleted(entry)))
        const directories = new Set(
          (existing?.directories ?? []).filter((entry) => !isDeleted(entry)),
        )
        for (const plannedFileName of resolvedFiles.keys()) {
          if (!isPathContained(runtime, directoryName, plannedFileName)) continue
          const relative = runtime.relative(directoryName, plannedFileName)
          const first = relative.split(runtime.sep)[0]!
          if (first === relative) files.add(first)
          else directories.add(first)
        }
        return existing === undefined && files.size === 0 && directories.size === 0
          ? undefined
          : { files: [...files], directories: [...directories] }
      },
      readFile: (fileName) => {
        const resolved = runtime.resolve(fileName)
        if (resolvedDeleted.has(resolved)) return null
        return resolvedFiles.get(resolved) ?? apiOptions.fs?.readFile?.(fileName)
      },
      fileExists: (fileName) => {
        const resolved = runtime.resolve(fileName)
        if (resolvedDeleted.has(resolved)) return false
        if (resolvedFiles.has(resolved)) return true
        return apiOptions.fs?.fileExists?.(fileName)
      },
      directoryExists: (directoryName) => {
        const resolved = runtime.resolve(directoryName)
        if (resolvedDeleted.has(resolved)) return false
        if (resolvedFiles.has(resolved)) return false
        for (const plannedFileName of resolvedFiles.keys()) {
          if (isPathContained(runtime, directoryName, plannedFileName)) return true
        }
        return apiOptions.fs?.directoryExists?.(directoryName)
      },
      realpath: (path) => {
        const resolved = runtime.resolve(path)
        if (resolvedDeleted.has(resolved)) return undefined
        if (resolvedFiles.has(resolved)) return resolved
        for (const plannedFileName of resolvedFiles.keys()) {
          if (isPathContained(runtime, path, plannedFileName)) return resolved
        }
        return apiOptions.fs?.realpath?.(path)
      },
    },
  }

  const changed = [...resolvedFiles.keys()].filter(
    (path) => !resolvedCreated.has(path) && !resolvedDeleted.has(path),
  )
  const fileChanges: Types.Mutable<WorkspaceFileChanges> = {}
  if (changed.length > 0) fileChanges.changed = changed
  if (resolvedCreated.size > 0) fileChanges.created = [...resolvedCreated]
  if (resolvedDeleted.size > 0) fileChanges.deleted = [...resolvedDeleted]

  return {
    options,
    transition: Object.keys(fileChanges).length > 0 ? { changes: fileChanges } : {},
  }
}
