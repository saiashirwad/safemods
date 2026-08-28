/** Workspace service orchestration and layer construction. */
import { Context, Effect, Layer, Semaphore } from "effect"
import type { APIOptions } from "typescript/unstable/async"
import { layer as nativeCompilerLayer, NativeCompiler } from "./internal/NativeCompiler.ts"
import type { WorkspaceCompilerError } from "./NativeRequest.ts"
import {
  InvalidProjectRelativePath,
  isPathContained,
  parseProjectRelativePath,
} from "../ProjectPath/index.ts"
import type { VirtualFsSnapshot } from "../VirtualFs/index.ts"
import {
  DuplicateConfiguredProject,
  type ProjectNotInSnapshot,
  type SnapshotTransition,
  type WorkspaceDefinition,
} from "./ConfiguredProject.ts"
import { type WorkspaceSnapshot, openSnapshotRegion } from "./SnapshotRegion.ts"
import { compilerOverlayFor } from "./internal/CompilerOverlay.ts"
import {
  attachInputObserver,
  inputObserverOf,
  type CompilerObservation,
} from "./internal/ObservedInputs.ts"
import { WorkspaceRuntime } from "./Runtime.ts"

export interface WorkspaceService {
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
  readonly compilerObservations: () => ReadonlyArray<CompilerObservation>
}

export class Workspace extends Context.Service<Workspace, WorkspaceService>()(
  // oxlint-disable-next-line effecttsgo/deterministic-keys -- Stable public service identifier.
  "@safemods/Workspace",
) {
  // The Node adapter owns public layer construction.
}

export const make = (
  definition: WorkspaceDefinition,
  apiOptions: APIOptions,
): Effect.Effect<
  Workspace["Service"],
  DuplicateConfiguredProject | InvalidProjectRelativePath,
  NativeCompiler | WorkspaceRuntime
> =>
  Effect.gen(function* () {
    const compiler = yield* NativeCompiler
    const runtime = yield* WorkspaceRuntime
    const projectPaths = {
      resolve: runtime.resolvePath,
      dirname: runtime.dirname,
      relative: runtime.relativePath,
      isAbsolute: runtime.isAbsolutePath,
      sep: runtime.pathSeparator,
    }
    const transitionLock = yield* Semaphore.make(1)
    const root = runtime.resolvePath(apiOptions.cwd ?? ".")
    const inputObserver = inputObserverOf(apiOptions.fs)

    const projects = Object.freeze([...definition.projects])
    const resolvedById = new Map<string, string>()
    for (const project of projects) {
      const relativeConfig = parseProjectRelativePath(project.config)
      const candidate =
        relativeConfig === undefined ? undefined : runtime.resolvePath(root, relativeConfig)
      const configFileName =
        candidate !== undefined && isPathContained(projectPaths, root, candidate)
          ? candidate
          : undefined
      if (configFileName === undefined) {
        return yield* new InvalidProjectRelativePath({ path: project.config })
      }
      if (resolvedById.has(project.id) || [...resolvedById.values()].includes(configFileName)) {
        return yield* new DuplicateConfiguredProject({ id: project.id, configFileName })
      }
      resolvedById.set(project.id, configFileName)
    }

    let opened = false

    const withSnapshot: WorkspaceService["withSnapshot"] = (transition, program) =>
      transitionLock.withPermit(
        Effect.suspend(() => {
          inputObserver?.reset()
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
      const isolated = compilerOverlayFor(runtime, root, apiOptions, overlay)
      return Effect.gen(function* () {
        const isolatedCompiler = yield* NativeCompiler
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
      }).pipe(Effect.provide(nativeCompilerLayer(isolated.options)))
    }

    return Workspace.of({
      definition,
      root,
      withSnapshot,
      withIsolatedSnapshot,
      compilerObservations: () => inputObserver?.snapshot() ?? [],
    })
  })

const layerWithoutDependencies = (
  definition: WorkspaceDefinition,
  options: APIOptions = {},
): Layer.Layer<
  Workspace,
  DuplicateConfiguredProject | InvalidProjectRelativePath,
  NativeCompiler | WorkspaceRuntime
> => Layer.effect(Workspace, make(definition, options))

export const layer = (
  definition: WorkspaceDefinition,
  options: APIOptions = {},
): Layer.Layer<
  Workspace,
  DuplicateConfiguredProject | InvalidProjectRelativePath,
  WorkspaceRuntime
> =>
  Layer.unwrap(
    WorkspaceRuntime.use((runtime) => {
      const observed = attachInputObserver(options, runtime)
      return Effect.succeed(
        layerWithoutDependencies(definition, observed).pipe(
          Layer.provide(nativeCompilerLayer(observed)),
        ),
      )
    }),
  )
