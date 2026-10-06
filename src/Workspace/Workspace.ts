import { Context, Data, Effect, Layer, Option, Path, Schema } from "effect"
import { API } from "typescript/unstable/async"
import type * as ProjectId from "../ProjectId.ts"
import * as WorkspacePath from "../WorkspacePath.ts"
import { nativeRequest, WorkspaceCompilerError } from "./NativeRequest.ts"
import { InputSnapshot } from "./InputSnapshot.ts"
import type * as Overlay from "./Overlay.ts"
import * as ProjectSnapshot from "./ProjectSnapshot.ts"
import type * as WorkspaceDefinition from "./WorkspaceDefinition.ts"

const decodePath = Schema.decodeOption(WorkspacePath.schema)

export class ProjectNotInSnapshot extends Data.TaggedError("ProjectNotInSnapshot")<{
  readonly projectId: ProjectId.Type
}> {}

export interface WorkspaceSnapshot {
  readonly projects: ReadonlyArray<ProjectSnapshot.ProjectSnapshot>
  readonly project: (
    projectId: ProjectId.Type,
  ) => Effect.Effect<ProjectSnapshot.ProjectSnapshot, ProjectNotInSnapshot>
  readonly files: (
    fileName: WorkspacePath.Type,
  ) => Effect.Effect<
    ReadonlyArray<ProjectSnapshot.ProjectFile>,
    ProjectSnapshot.ProjectSnapshotError
  >
  readonly capture: Effect.Effect<
    ReadonlyMap<WorkspacePath.Type, Uint8Array>,
    ProjectSnapshot.ProjectSnapshotError | WorkspaceCompilerError
  >
}

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly definition: WorkspaceDefinition.Type
    readonly root: string
    readonly absolutePath: (fileName: WorkspacePath.Type) => string
    readonly relativePath: (absolute: string) => WorkspacePath.Type | undefined
    readonly withSnapshot: <A, E, R>(
      use: (snapshot: WorkspaceSnapshot) => Effect.Effect<A, E, R>,
      options?: { readonly overlay?: Overlay.Overlay; readonly inputs?: InputSnapshot },
    ) => Effect.Effect<
      A,
      E | WorkspaceCompilerError | ProjectSnapshot.ProjectSnapshotError,
      R
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
    withSnapshot: (use, options) =>
      Effect.gen(function* () {
        const inputs = options?.inputs ?? new InputSnapshot()
        const overlay = options?.overlay === undefined ? undefined : {
          files: new Map(
            [...options.overlay.files].map(([name, text]) => [path.resolve(name), text]),
          ),
          deleted: new Set([...options.overlay.deleted].map((name) => path.resolve(name))),
        }
        const fs = inputs.fileSystem(overlay)
        for (const configured of definition.projects) {
          const config = absolutePath(configured.config)
          yield* Effect.try({
            try: () => {
              if (fs.readFile(config) === null) {
                throw new Error(`Configured project is missing: ${config}`)
              }
            },
            catch: (cause) => new WorkspaceCompilerError({ operation: "readConfig", cause }),
          })
        }
        const api = yield* Effect.acquireRelease(
          Effect.try({
            try: () => new API({ cwd: root, fs }),
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

        const projects: Array<ProjectSnapshot.ProjectSnapshot> = []
        for (const configured of definition.projects) {
          const nativeProject = native.getProject(absolutePath(configured.config))
          if (nativeProject === undefined) {
            return yield* new WorkspaceCompilerError({
              operation: "getProject",
              cause: new Error(`Configured project is missing: ${absolutePath(configured.config)}`),
            })
          }
          projects.push(ProjectSnapshot.make({
            configured,
            native: nativeProject,
            path,
            workspaceRoot: root,
            ensureActive,
          }))
        }

        const snapshot: WorkspaceSnapshot = {
          projects,
          project: (projectId) => {
            const project = projects.find((candidate) => candidate.project.id === projectId)
            return project === undefined ?
              new ProjectNotInSnapshot({ projectId }) :
              Effect.succeed(project)
          },
          files: (fileName) =>
            Effect.map(
              Effect.forEach(projects, (project) => project.file(fileName)),
              (files) => files.filter((file) => file !== undefined),
            ),
          capture: Effect.gen(function* () {
            yield* ensureActive
            const captured = new Map<WorkspacePath.Type, Uint8Array>()
            for (const project of projects) {
              const fileNames = [
                project.project.config,
                ...(yield* project.files).map((file) => file.fileName),
              ]
              for (const fileName of fileNames) {
                if (!captured.has(fileName)) {
                  const absolute = absolutePath(fileName)
                  const bytes = yield* Effect.try({
                    try: () => {
                      const text = overlay?.files.get(absolute)
                      const bytes = overlay?.deleted.has(absolute) ?
                        undefined :
                        text === undefined ?
                        inputs.readBytes(absolute) :
                        new TextEncoder().encode(text)
                      if (bytes === undefined) {
                        throw new Error(`Snapshot file is missing: ${absolute}`)
                      }
                      return bytes
                    },
                    catch: (cause) => new WorkspaceCompilerError({ operation: "capture", cause }),
                  })
                  captured.set(fileName, bytes)
                }
              }
            }
            return captured
          }),
        }

        return yield* Effect.suspend(() => use(snapshot)).pipe(
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
