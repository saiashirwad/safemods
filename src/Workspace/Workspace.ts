import * as Path from "node:path"
import { Context, Data, Effect, Layer } from "effect"
import { API } from "typescript/unstable/async"
import type * as FileRef from "../FileRef.ts"
import type * as ProjectId from "../ProjectId.ts"
import { nativeRequest, type WorkspaceCompilerError } from "./NativeRequest.ts"
import * as Overlay from "./Overlay.ts"
import * as ProjectSnapshot from "./ProjectSnapshot.ts"
import type * as WorkspaceDefinition from "./WorkspaceDefinition.ts"

export class ProjectNotInSnapshot extends Data.TaggedError("ProjectNotInSnapshot")<{
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
  }
>()("safemods/Workspace/Workspace/WorkspaceSnapshot") {}

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly definition: WorkspaceDefinition.Type
    readonly root: string
    readonly projectRoot: (projectId: ProjectId.Type) => string
    readonly absolutePath: (file: FileRef.FileRef) => string
    readonly withSnapshot: <A, E, R>(
      program: Effect.Effect<A, E, R | WorkspaceSnapshot>,
      overlay?: Overlay.Overlay,
    ) => Effect.Effect<
      A,
      | E
      | WorkspaceCompilerError
      | ProjectSnapshot.ProjectSnapshotError
      | OverlappingProjectOwnership,
      Exclude<R, WorkspaceSnapshot>
    >
  }
>()("safemods/Workspace/Workspace") {}

const make = (definition: WorkspaceDefinition.Type, cwd: string): Workspace["Service"] => {
  const root = Path.resolve(cwd)
  const configFiles = new Map(
    definition.projects.map((project) => [project.id, Path.join(root, project.config)]),
  )
  const projectRoot = (projectId: ProjectId.Type): string => {
    const configFile = configFiles.get(projectId)
    if (configFile === undefined) throw new Error(`Unknown project ${projectId}`)
    return Path.dirname(configFile)
  }

  return {
    definition,
    root,
    projectRoot,
    absolutePath: (file) => Path.join(projectRoot(file.projectId), file.fileName),
    withSnapshot: (program, overlay) =>
      Effect.gen(function* () {
        const api = yield* Effect.acquireRelease(
          Effect.sync(
            () =>
              new API(
                overlay === undefined
                  ? { cwd: root }
                  : { cwd: root, fs: Overlay.fileSystem(overlay) },
              ),
          ),
          (api) => Effect.promise(() => api.close()),
        )
        const native = yield* Effect.acquireRelease(
          nativeRequest("updateSnapshot", () =>
            api.updateSnapshot({ openProjects: [...configFiles.values()] }),
          ),
          (snapshot) => Effect.promise(() => snapshot.dispose()),
        )

        let active = true
        const ensureActive = Effect.suspend(() =>
          active ? Effect.void : Effect.fail(new ProjectSnapshot.SnapshotExpired()),
        )

        const projects = new Map(
          definition.projects.flatMap((configured) => {
            const configFile = configFiles.get(configured.id)
            const nativeProject = configFile === undefined ? undefined : native.getProject(configFile)
            return configFile === undefined || nativeProject === undefined
              ? []
              : [
                  [
                    configured.id,
                    ProjectSnapshot.make({
                      configured,
                      native: nativeProject,
                      projectRoot: Path.dirname(configFile),
                      ensureActive,
                    }),
                  ] as const,
                ]
          }),
        )
        const ownership = new Map<string, Array<ProjectId.Type>>()
        for (const project of projects.values()) {
          for (const file of yield* project.files) {
            const absolute = Path.resolve(projectRoot(project.project.id), file.fileName)
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
            return project === undefined
              ? Effect.fail(new ProjectNotInSnapshot({ projectId }))
              : Effect.succeed(project)
          },
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

export const layer = (definition: WorkspaceDefinition.Type, root: string): Layer.Layer<Workspace> =>
  Layer.succeed(Workspace, make(definition, root))
