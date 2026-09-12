/** Workspace service orchestration and layer construction. */
import { Context, Effect, Layer, Semaphore, type Scope } from "effect"
import type { APIOptions } from "typescript/unstable/async"
import { openCompiler } from "./internal/NativeCompiler.ts"
import type { WorkspaceCompilerError } from "./NativeRequest.ts"
import {
  InvalidProjectRelativePath,
  isPathContained,
  parseProjectRelativePath,
} from "../ProjectPath.ts"
import type { VirtualFsSnapshot } from "../VirtualFs.ts"
import {
  DuplicateConfiguredProject,
  type ProjectNotInSnapshot,
  type SnapshotTransition,
  type WorkspaceDefinition,
} from "./ConfiguredProject.ts"
import { type WorkspaceSnapshot, openSnapshotRegion } from "./SnapshotRegion.ts"
import { compilerOverlayFor } from "./internal/CompilerOverlay.ts"
import { WorkspaceRuntime } from "./Runtime.ts"

interface WorkspaceService {
  readonly definition: WorkspaceDefinition
  /** Absolute workspace root. Runtime configuration, not durable identity. */
  readonly root: string
  readonly withSnapshot: <A, E, R>(
    transition: SnapshotTransition,
    program: Effect.Effect<A, E, R | WorkspaceSnapshot>,
  ) => Effect.Effect<
    A,
    E | WorkspaceCompilerError | ProjectNotInSnapshot,
    Exclude<R, WorkspaceSnapshot>
  >
  /** Run a program against a fresh compiler over a read-only virtual filesystem. */
  readonly withIsolatedSnapshot: <A, E, R>(
    overlay: VirtualFsSnapshot,
    program: Effect.Effect<A, E, R | WorkspaceSnapshot>,
  ) => Effect.Effect<
    A,
    E | WorkspaceCompilerError | ProjectNotInSnapshot,
    Exclude<R, WorkspaceSnapshot>
  >
}

export class Workspace extends Context.Service<Workspace, WorkspaceService>()(
  // oxlint-disable-next-line effecttsgo/deterministic-keys -- Stable public service identifier.
  "@safemods/Workspace",
) {
  // The Node adapter owns public layer construction.
}

const make = (
  definition: WorkspaceDefinition,
  apiOptions: APIOptions,
): Effect.Effect<
  Workspace["Service"],
  DuplicateConfiguredProject | InvalidProjectRelativePath,
  Scope.Scope | WorkspaceRuntime
> =>
  Effect.gen(function* () {
    const runtime = yield* WorkspaceRuntime
    const compiler = yield* openCompiler(apiOptions)
    const transitionLock = yield* Semaphore.make(1)
    const root = runtime.resolve(apiOptions.cwd ?? ".")

    const projects = Object.freeze([...definition.projects])
    const resolvedById = new Map<string, string>()
    const configs = new Set<string>()
    for (const project of projects) {
      const relativeConfig = parseProjectRelativePath(project.config)
      if (relativeConfig === undefined) {
        return yield* new InvalidProjectRelativePath({ path: project.config })
      }
      const configFileName = runtime.resolve(root, relativeConfig)
      if (!isPathContained(runtime, root, configFileName)) {
        return yield* new InvalidProjectRelativePath({ path: project.config })
      }
      if (resolvedById.has(project.id) || configs.has(configFileName)) {
        return yield* new DuplicateConfiguredProject({ id: project.id, configFileName })
      }
      resolvedById.set(project.id, configFileName)
      configs.add(configFileName)
    }

    let opened = false

    const withSnapshot: WorkspaceService["withSnapshot"] = (transition, program) =>
      transitionLock.withPermit(
        Effect.suspend(() => {
          const openProjects = opened ? undefined : [...resolvedById.values()]
          return openSnapshotRegion(
            {
              regionCompiler: compiler,
              projects,
              resolvedById,
              openProjects,
              transition,
              onOpened: () => {
                opened = true
              },
              runtime,
            },
            program,
          )
        }),
      )

    const withIsolatedSnapshot: WorkspaceService["withIsolatedSnapshot"] = (overlay, program) => {
      const isolated = compilerOverlayFor(runtime, apiOptions, overlay)
      return Effect.scoped(
        Effect.gen(function* () {
          const isolatedCompiler = yield* openCompiler(isolated.options)
          return yield* openSnapshotRegion(
            {
              regionCompiler: isolatedCompiler,
              projects,
              resolvedById,
              openProjects: [...resolvedById.values()],
              transition: isolated.transition,
              runtime,
            },
            program,
          )
        }),
      )
    }

    return Workspace.of({
      definition,
      root,
      withSnapshot,
      withIsolatedSnapshot,
    })
  })

export const layer = (
  definition: WorkspaceDefinition,
  options: APIOptions = {},
): Layer.Layer<
  Workspace,
  DuplicateConfiguredProject | InvalidProjectRelativePath,
  WorkspaceRuntime
> => Layer.effect(Workspace, make(definition, options))
