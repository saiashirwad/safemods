/** Native compiler filesystem options for an isolated virtual snapshot. */
import type { APIOptions } from "typescript/unstable/async"
import { isPathContained } from "../../ProjectPath/index.ts"
import type { VirtualFsSnapshot } from "../../VirtualFs/index.ts"
import type { SnapshotTransition } from "../ConfiguredProject.ts"
import type { WorkspaceRuntimeService } from "../Runtime.ts"

export interface CompilerOverlay {
  readonly options: APIOptions
  readonly transition: SnapshotTransition
}

interface WorkspaceFileChanges {
  changed?: ReadonlyArray<string>
  created?: ReadonlyArray<string>
  deleted?: ReadonlyArray<string>
}

/** Build the compiler overlay without writing to the workspace. */
export const compilerOverlayFor = (
  runtime: WorkspaceRuntimeService,
  apiOptions: APIOptions,
  overlay: VirtualFsSnapshot,
): CompilerOverlay => {
  const deleted = overlay.deleted
  const created = overlay.created
  const resolvedFiles = new Map<string, string>()
  for (const [fileName, content] of overlay.files) {
    resolvedFiles.set(runtime.resolve(fileName), content)
  }
  const resolvedDeleted = new Set<string>()
  for (const fileName of deleted) {
    resolvedDeleted.add(runtime.resolve(fileName))
  }

  const options: APIOptions = {
    ...apiOptions,
    fs: {
      ...apiOptions.fs,
      getAccessibleEntries: (directoryName) => {
        const delegated = apiOptions.fs?.getAccessibleEntries?.(directoryName)
        const existing =
          delegated ??
          (() => {
            try {
              return runtime.directoryEntries(directoryName)
            } catch {
              return undefined
            }
          })()
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
    },
  }

  const changed = [...overlay.files.keys()].filter(
    (path) => !created.has(path) && !deleted.has(path),
  )
  const fileChanges: WorkspaceFileChanges = {}
  if (changed.length > 0) fileChanges.changed = changed
  if (created.size > 0) fileChanges.created = [...created]
  if (deleted.size > 0) fileChanges.deleted = [...deleted]

  return {
    options,
    transition: Object.keys(fileChanges).length > 0 ? { changes: fileChanges } : {},
  }
}
