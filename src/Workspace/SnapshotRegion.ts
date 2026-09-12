/** Snapshot-region lifetime and service provisioning. */
import { Context, Effect } from "effect"
import type { FileChangeSummary, UpdateSnapshotParams } from "typescript/unstable/proto"
import type { NativeCompiler } from "./internal/NativeCompiler.ts"
import type { WorkspaceCompilerError } from "./NativeRequest.ts"
import {
  type ConfiguredProject,
  ProjectNotInSnapshot,
  type SnapshotTransition,
} from "./ConfiguredProject.ts"
import { projectSnapshotFor, SnapshotExpired, type ProjectSnapshot } from "./ProjectSnapshot.ts"
import type { WorkspaceRuntimeService } from "./Runtime.ts"

export interface WorkspaceSnapshotService {
  readonly projects: ReadonlyArray<ConfiguredProject>
  readonly project: (
    project: ConfiguredProject,
  ) => Effect.Effect<ProjectSnapshot, ProjectNotInSnapshot | SnapshotExpired>
}

export class WorkspaceSnapshot extends Context.Service<
  WorkspaceSnapshot,
  WorkspaceSnapshotService
>()(
  // oxlint-disable-next-line effecttsgo/deterministic-keys -- Stable public service identifier.
  "@safemods/WorkspaceSnapshot",
) {}

interface OpenSnapshotRegionOptions {
  readonly regionCompiler: NativeCompiler
  readonly projects: ReadonlyArray<ConfiguredProject>
  readonly resolvedById: ReadonlyMap<string, string>
  readonly openProjects: ReadonlyArray<string> | undefined
  readonly transition: SnapshotTransition
  readonly onOpened?: (() => void) | undefined
  readonly runtime: WorkspaceRuntimeService
}

/** Open one native snapshot and expire all its native values after the program. */
export const openSnapshotRegion = <A, E, R>(
  options: OpenSnapshotRegionOptions,
  program: Effect.Effect<A, E, R | WorkspaceSnapshot>,
): Effect.Effect<A, E | WorkspaceCompilerError, Exclude<R, WorkspaceSnapshot>> =>
  Effect.scoped(
    Effect.gen(function* () {
      const params: UpdateSnapshotParams = {}
      if (options.openProjects !== undefined) {
        params.openProjects = [...options.openProjects]
      }
      if (options.transition.changes !== undefined) {
        const changes = options.transition.changes
        const fileChanges: FileChangeSummary = {}
        if (changes.changed !== undefined) fileChanges.changed = [...changes.changed]
        if (changes.created !== undefined) fileChanges.created = [...changes.created]
        if (changes.deleted !== undefined) fileChanges.deleted = [...changes.deleted]
        params.fileChanges = fileChanges
      }
      const nativeSnapshot = yield* options.regionCompiler
        .openSnapshot(params)
        .pipe(
          Effect.tap(() =>
            options.onOpened !== undefined ? Effect.sync(options.onOpened) : Effect.void,
          ),
        )

      const active = { current: true }
      const ensureActive = Effect.suspend((): Effect.Effect<void, SnapshotExpired> =>
        active.current
          ? Effect.void
          : Effect.fail(new SnapshotExpired({ generation: nativeSnapshot.id })),
      )

      const project = Effect.fn("WorkspaceSnapshot.project")(function* (
        configured: ConfiguredProject,
      ) {
        yield* ensureActive
        const configFileName = options.resolvedById.get(configured.id)
        const nativeProject =
          configFileName === undefined ? undefined : nativeSnapshot.getProject(configFileName)
        if (configFileName === undefined || nativeProject === undefined) {
          return yield* new ProjectNotInSnapshot({
            projectId: configured.id,
            generation: nativeSnapshot.id,
          })
        }

        return projectSnapshotFor({
          configured,
          nativeProject,
          projectRoot: options.runtime.dirname(configFileName),
          ensureActive,
          runtime: options.runtime,
        })
      })

      const snapshotService = WorkspaceSnapshot.of({
        projects: options.projects,
        project,
      })

      return yield* program.pipe(
        Effect.provideService(WorkspaceSnapshot, snapshotService),
        Effect.ensuring(
          Effect.sync(() => {
            active.current = false
          }),
        ),
      )
    }),
  )
