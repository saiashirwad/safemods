import { Context, Data, Effect, FileSystem, Layer, Path, type PlatformError } from "effect"
import { API } from "typescript/unstable/async"
import * as FileRef from "../FileRef.ts"
import type * as ProjectId from "../ProjectId.ts"
import * as ProjectRelativePath from "../ProjectRelativePath.ts"
import { nativeRequest, WorkspaceCompilerError } from "./NativeRequest.ts"
import * as Overlay from "./Overlay.ts"
import * as ProjectSnapshot from "./ProjectSnapshot.ts"
import type * as WorkspaceDefinition from "./WorkspaceDefinition.ts"

export class ProjectNotInSnapshot extends Data.TaggedError("ProjectNotInSnapshot")<{
  readonly projectId: ProjectId.Type
}> {}

export class ProjectNotInWorkspace extends Data.TaggedError("ProjectNotInWorkspace")<{
  readonly projectId: ProjectId.Type
}> {}

export class OverlappingProjectOwnership extends Data.TaggedError("OverlappingProjectOwnership")<{
  readonly fileName: string
  readonly projectIds: ReadonlyArray<ProjectId.Type>
}> {}

export class WorkspaceSnapshot extends Context.Service<
  WorkspaceSnapshot,
  {
    readonly projects: ReadonlyArray<ProjectSnapshot.ProjectSnapshot>
    readonly project: (
      projectId: ProjectId.Type,
    ) => Effect.Effect<ProjectSnapshot.ProjectSnapshot, ProjectNotInSnapshot>
    readonly capture: Effect.Effect<
      FileRef.ReadonlyMap<Uint8Array | undefined>,
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
    readonly projectRoot: (
      projectId: ProjectId.Type,
    ) => Effect.Effect<string, ProjectNotInWorkspace>
    readonly absolutePath: (file: FileRef.FileRef) => Effect.Effect<string, ProjectNotInWorkspace>
    readonly withSnapshot: <A, E, R>(
      program: Effect.Effect<A, E, R | WorkspaceSnapshot>,
      overlay?: Overlay.Overlay,
    ) => Effect.Effect<
      A,
      | E
      | WorkspaceCompilerError
      | ProjectSnapshot.ProjectSnapshotError
      | ProjectNotInWorkspace
      | OverlappingProjectOwnership,
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
  const configFiles = new Map(
    definition.projects.map((project) => [project.id, path.join(root, project.config)]),
  )
  const projectRoot = (projectId: ProjectId.Type) => {
    const configFile = configFiles.get(projectId)
    return configFile === undefined ?
      Effect.fail(new ProjectNotInWorkspace({ projectId })) :
      Effect.succeed(path.dirname(configFile))
  }

  return {
    definition,
    root,
    projectRoot,
    absolutePath: (file) =>
      Effect.map(projectRoot(file.projectId), (projectRoot) =>
        file.fileName.startsWith("../") ?
          path.join(root, file.fileName.slice(3)) :
          path.join(projectRoot, file.fileName)),
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
            api.updateSnapshot({ openProjects: [...configFiles.values()] })),
          (snapshot) =>
            nativeRequest("disposeSnapshot", () =>
              snapshot.dispose()).pipe(Effect.ignore),
        )

        let active = true
        const ensureActive = Effect.suspend(() =>
          active ? Effect.void : Effect.fail(new ProjectSnapshot.SnapshotExpired())
        )

        const projects = new Map(
          definition.projects.flatMap((configured) => {
            const configFile = configFiles.get(configured.id)
            const nativeProject = configFile === undefined ?
              undefined :
              native.getProject(configFile)
            return configFile === undefined || nativeProject === undefined ?
              [] :
              [
                [
                  configured.id,
                  ProjectSnapshot.make({
                    configured,
                    native: nativeProject,
                    path,
                    workspaceRoot: root,
                    projectRoot: path.dirname(configFile),
                    ensureActive,
                  }),
                ] as const,
              ]
          }),
        )
        const ownership = new Map<string, Array<ProjectId.Type>>()
        for (const project of projects.values()) {
          const configFile = configFiles.get(project.project.id)!
          for (const file of yield* project.files) {
            const absolute = path.resolve(
              file.fileName.startsWith("../") ? root : path.dirname(configFile),
              file.fileName.startsWith("../") ? file.fileName.slice(3) : file.fileName,
            )
            const owners = ownership.get(absolute) ?? []
            owners.push(project.project.id)
            ownership.set(absolute, owners)
          }
        }
        const overlap = [...ownership].find(([, owners]) => owners.length > 1)
        if (overlap !== undefined) {
          return yield* new OverlappingProjectOwnership({
            fileName: overlap[0],
            projectIds: overlap[1],
          })
        }

        const snapshot = WorkspaceSnapshot.of({
          projects: [...projects.values()],
          project: (projectId) => {
            const project = projects.get(projectId)
            return project === undefined ?
              Effect.fail(new ProjectNotInSnapshot({ projectId })) :
              Effect.succeed(project)
          },
          capture: Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            const captured: FileRef.Map<Uint8Array | undefined> = new Map()
            for (const project of projects.values()) {
              const configured = project.project
              const configFile = configFiles.get(configured.id)!
              FileRef.set(
                captured,
                {
                  projectId: configured.id,
                  fileName: ProjectRelativePath.schema.make(path.basename(configFile)),
                },
                yield* fs.readFile(configFile),
              )
              for (const file of yield* project.files) {
                FileRef.set(
                  captured,
                  { projectId: configured.id, fileName: file.fileName },
                  yield* fs.readFile(
                    file.fileName.startsWith("../") ?
                      path.join(root, file.fileName.slice(3)) :
                      path.join(path.dirname(configFile), file.fileName),
                  ),
                )
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
