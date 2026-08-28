/** Durable workspace input fingerprinting. */
import { Effect, FileSystem, Path } from "effect"
import { sha256 } from "../Edit/Hash.ts"
import { compareSourceFingerprints, type SourceFingerprint } from "../Plan/index.ts"
import {
  parseProjectRelativePath,
  projectRelative,
  type ProjectRelativePath,
} from "../ProjectPath/index.ts"
import type {
  ProjectNotInSnapshot,
  SnapshotExpired,
  WorkspaceCompilerError,
  WorkspaceSnapshotService,
} from "../Workspace/index.ts"

const observationRelativePath = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  projectRoot: string,
  absolute: string,
): Effect.Effect<ProjectRelativePath | undefined> =>
  Effect.gen(function* () {
    const direct = parseProjectRelativePath(projectRelative(path, projectRoot, absolute))
    if (direct !== undefined) return direct

    const realRoot = yield* fs.realPath(projectRoot).pipe(Effect.orElseSucceed(() => undefined))
    if (realRoot === undefined) return undefined
    const realAbsolute = yield* fs.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute))
    return parseProjectRelativePath(projectRelative(path, realRoot, realAbsolute))
  })

const fingerprintKey = (source: SourceFingerprint): string =>
  `${source.projectId}\0${source.kind ?? "file"}\0${source.fileName}`

const addFingerprint = (
  sources: Map<string, SourceFingerprint>,
  source: SourceFingerprint,
): void => {
  const relative = parseProjectRelativePath(source.fileName)
  if (relative === undefined) return
  const next = { ...source, fileName: relative }
  sources.set(fingerprintKey(next), next)
}

/** Record compiler inputs that verification can revalidate. */
export const fingerprintWorkspace = (
  workspaceRoot: string,
  snapshot: WorkspaceSnapshotService,
): Effect.Effect<
  ReadonlyArray<SourceFingerprint>,
  WorkspaceCompilerError | ProjectNotInSnapshot | SnapshotExpired,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const sources = new Map<string, SourceFingerprint>()
    for (const configured of snapshot.projects) {
      const project = yield* snapshot.project(configured)
      const owned = (yield* project.sourceFileNames).filter(
        (fileName) =>
          parseProjectRelativePath(projectRelative(path, project.root, fileName)) !== undefined,
      )
      const files = [...new Set(owned)].sort()
      const configFileName = path.resolve(workspaceRoot, configured.config)
      const contentFiles = [configFileName, ...files]

      for (const absolute of contentFiles) {
        const relative = yield* observationRelativePath(fs, path, project.root, absolute)
        if (relative === undefined) continue
        const content = yield* fs
          .readFileString(absolute, "utf8")
          .pipe(Effect.orElseSucceed(() => undefined))
        if (content === undefined) {
          addFingerprint(sources, {
            projectId: configured.id,
            fileName: relative,
            hash: "",
            kind: "missing",
          })
        } else {
          addFingerprint(sources, {
            projectId: configured.id,
            fileName: relative,
            hash: sha256(content),
          })
        }
      }
    }
    return [...sources.values()].sort(compareSourceFingerprints)
  })
