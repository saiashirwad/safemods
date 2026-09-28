import {
  Context,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  type PlatformError,
  Schema,
} from "effect"
import { API } from "typescript/unstable/async"
import type * as ProjectId from "../ProjectId.ts"
import * as WorkspacePath from "../WorkspacePath.ts"
import { nativeRequest, WorkspaceCompilerError } from "./NativeRequest.ts"
import * as Overlay from "./Overlay.ts"
import * as ProjectSnapshot from "./ProjectSnapshot.ts"
import type * as WorkspaceDefinition from "./WorkspaceDefinition.ts"

const decodePath = Schema.decodeOption(WorkspacePath.schema)

export class ProjectNotInSnapshot extends Data.TaggedError("ProjectNotInSnapshot")<{
  readonly projectId: ProjectId.Type
}> {}

export class WorkspaceSnapshot extends Context.Service<
  WorkspaceSnapshot,
  {
    readonly projects: ReadonlyArray<ProjectSnapshot.ProjectSnapshot>
    readonly project: (
      projectId: ProjectId.Type,
    ) => Effect.Effect<ProjectSnapshot.ProjectSnapshot, ProjectNotInSnapshot>
    readonly file: (
      fileName: WorkspacePath.Type,
    ) => Effect.Effect<
      ProjectSnapshot.ProjectFile | undefined,
      ProjectSnapshot.ProjectSnapshotError
    >
    readonly capture: Effect.Effect<
      ReadonlyMap<WorkspacePath.Type, Uint8Array>,
      ProjectSnapshot.ProjectSnapshotError | PlatformError.PlatformError,
      FileSystem.FileSystem
    >
  }
>()("safemods/Workspace/Workspace/WorkspaceSnapshot") {}

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly definition: WorkspaceDefinition.Type
    readonly root: string
    readonly absolutePath: (fileName: WorkspacePath.Type) => string
    readonly relativePath: (absolute: string) => WorkspacePath.Type | undefined
    readonly withSnapshot: <A, E, R>(
      program: Effect.Effect<A, E, R | WorkspaceSnapshot>,
      overlay?: Overlay.Overlay,
    ) => Effect.Effect<
      A,
      E | WorkspaceCompilerError | ProjectSnapshot.ProjectSnapshotError,
      Exclude<R, WorkspaceSnapshot>
    >
  }
>()("safemods/Workspace/Workspace") {}

const make = (
  definition: WorkspaceDefinition.Type,
  cwd: string,
  path: Path.Path,
): Workspace["Service"] => {
  const root = path.resolve(cwd)
  const absolutePath = (fileName: WorkspacePath.Type) => path.join(root, fileName)
  const relativePath = (absolute: string) =>
    Option.getOrUndefined(decodePath(path.relative(root, path.resolve(root, absolute))))

  return {
    definition,
    root,
    absolutePath,
    relativePath,
    withSnapshot: (program, overlay) =>
      Effect.gen(function* () {
        const api = yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              new API(
                overlay === undefined ?
                  { cwd: root } :
                  { cwd: root, fs: Overlay.fileSystem(overlay, path) },
              ),
            catch: (cause) => new WorkspaceCompilerError({ operation: "createAPI", cause }),
          }),
          (api) => nativeRequest("closeAPI", () => api.close()).pipe(Effect.ignore),
        )
        const native = yield* Effect.acquireRelease(
          nativeRequest("updateSnapshot", () =>
            api.updateSnapshot({
              openProjects: definition.projects.map(({ config }) => absolutePath(config)),
            })),
          (snapshot) =>
            nativeRequest("disposeSnapshot", () => snapshot.dispose()).pipe(Effect.ignore),
        )

        let active = true
        const ensureActive = Effect.suspend(() =>
          active ? Effect.void : new ProjectSnapshot.SnapshotExpired()
        )

        const projects = definition.projects.flatMap((configured) => {
          const nativeProject = native.getProject(absolutePath(configured.config))
          return nativeProject === undefined ?
            [] :
            [
              ProjectSnapshot.make({
                configured,
                native: nativeProject,
                path,
                workspaceRoot: root,
                ensureActive,
              }),
            ]
        })

        const snapshot = WorkspaceSnapshot.of({
          projects,
          project: (projectId) => {
            const project = projects.find((candidate) => candidate.project.id === projectId)
            return project === undefined ?
              new ProjectNotInSnapshot({ projectId }) :
              Effect.succeed(project)
          },
          file: (fileName) =>
            Effect.gen(function* () {
              for (const project of projects) {
                const file = yield* project.file(fileName)
                if (file !== undefined) return file
              }
              return undefined
            }),
          capture: Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            const captured = new Map<WorkspacePath.Type, Uint8Array>()
            for (const project of projects) {
              const fileNames = [
                project.project.config,
                ...(yield* project.files).map((file) => file.fileName),
              ]
              for (const fileName of fileNames) {
                if (!captured.has(fileName)) {
                  captured.set(fileName, yield* fs.readFile(absolutePath(fileName)))
                }
              }
            }
            return captured
          }),
        })

        return yield* program.pipe(
          Effect.provideService(WorkspaceSnapshot, snapshot),
          Effect.ensuring(
            Effect.sync(() => {
              active = false
            }),
          ),
        )
      }).pipe(Effect.scoped),
  }
}

export const layer = (
  definition: WorkspaceDefinition.Type,
  root: string,
): Layer.Layer<Workspace, never, Path.Path> =>
  Layer.effect(
    Workspace,
    Effect.gen(function* () {
      return make(definition, root, yield* Path.Path)
    }),
  )
