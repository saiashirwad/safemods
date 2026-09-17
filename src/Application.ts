import { randomUUID } from "node:crypto"
import { Data, Effect, FileSystem, Path, type PlatformError } from "effect"
import * as Sha256 from "./Sha256.ts"
import { type FilePreview, StalePlanError, type VerifiedPlan } from "./Verification/index.ts"
import { applicationState } from "./Verification/VerifiedPlan.ts"

export interface ApplicationOperationFailure {
  readonly phase: "commit" | "rollback" | "cleanup"
  readonly operation: "write" | "remove" | "restore" | "cleanup-temporary" | "cleanup-backup"
  readonly path: string
  readonly cause: unknown
}

export class ApplicationFailure extends Data.TaggedError("ApplicationFailure")<{
  readonly planId: string
  readonly reason: "unissued" | "path-escape" | "filesystem" | "recovery"
  readonly cause?: unknown
  readonly failures?: ReadonlyArray<ApplicationOperationFailure>
}> {}

export interface ApplicationReceipt {
  readonly planId: Sha256.Type
  readonly written: ReadonlyArray<FilePreview>
  readonly removed: ReadonlyArray<FilePreview>
}

export const applyVerifiedPlan = Effect.fn("Application.applyVerifiedPlan")(function* (
  verified: VerifiedPlan,
) {
  const state = applicationState(verified)
  if (state === undefined) {
    return yield* new ApplicationFailure({ planId: "unissued", reason: "unissued" })
  }
  const { workspace, plan, preview } = state
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const failed = (cause: unknown) =>
    new ApplicationFailure({ planId: plan.planId, reason: "filesystem", cause })

  const isWithin = (directory: string, candidate: string): boolean => {
    const relative = path.relative(directory, candidate)
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    )
  }
  const nearestExisting = (target: string): Effect.Effect<string, ApplicationFailure> =>
    fs.exists(target).pipe(
      Effect.mapError(failed),
      Effect.flatMap((exists) =>
        exists ? Effect.succeed(target) : nearestExisting(path.dirname(target)),
      ),
    )
  const confinedTarget = Effect.fn(function* (file: FilePreview) {
    const target = yield* workspace
      .absolutePath(file)
      .pipe(
        Effect.mapError(
          (cause) => new ApplicationFailure({ planId: plan.planId, reason: "path-escape", cause }),
        ),
      )
    const realWorkspace = yield* fs.realPath(workspace.root).pipe(Effect.mapError(failed))
    const projectRoot = yield* workspace
      .projectRoot(file.projectId)
      .pipe(
        Effect.mapError(
          (cause) => new ApplicationFailure({ planId: plan.planId, reason: "path-escape", cause }),
        ),
      )
    const realProject = yield* fs.realPath(projectRoot).pipe(Effect.mapError(failed))
    const anchor = yield* nearestExisting(target)
    const realAnchor = yield* fs.realPath(anchor).pipe(Effect.mapError(failed))
    if (!isWithin(realWorkspace, realProject) || !isWithin(realProject, realAnchor)) {
      return yield* new ApplicationFailure({ planId: plan.planId, reason: "path-escape" })
    }
    return target
  })
  const requireUnchanged = Effect.fn(function* (file: FilePreview, target: string) {
    const stale = new StalePlanError({
      planId: plan.planId,
      projectId: file.projectId,
      fileName: file.fileName,
    })
    const exists = yield* fs.exists(target).pipe(Effect.mapError(failed))
    if (exists !== file.before.exists) return yield* stale
    if (!file.before.exists) return
    const bytes = yield* fs.readFile(target).pipe(Effect.mapError(failed))
    if (Sha256.digest(bytes) !== Sha256.digest(file.before.bytes)) return yield* stale
  })

  const checkedSources = []
  for (const source of preview.sources) {
    const target = yield* confinedTarget(source)
    yield* requireUnchanged(source, target)
    checkedSources.push({ file: source, target })
  }
  const targets: Array<{
    file: FilePreview
    target: string
    mode: number | undefined
  }> = []
  for (const file of preview.files) {
    const target = yield* confinedTarget(file)
    const modeSource = file.movedFrom
      ? checkedSources.find(
          ({ file: source }) =>
            source.projectId === file.projectId && source.fileName === file.movedFrom,
        )?.target
      : file.before.exists
        ? target
        : undefined
    const mode = modeSource
      ? (yield* fs.stat(modeSource).pipe(Effect.mapError(failed))).mode
      : undefined
    targets.push({ file, target, mode })
  }

  const backups: Array<{ target: string; backup: string }> = []
  const written = new Set<string>()
  const temporaries = new Set<string>()
  const attempt = Effect.fn(function* (
    phase: ApplicationOperationFailure["phase"],
    operation: ApplicationOperationFailure["operation"],
    target: string,
    action: Effect.Effect<void, PlatformError.PlatformError>,
  ) {
    return yield* action.pipe(
      Effect.as(undefined),
      Effect.catch((cause) =>
        Effect.succeed({
          phase,
          operation,
          path: target,
          cause,
        } satisfies ApplicationOperationFailure),
      ),
    )
  })
  const rollback = Effect.fn(function* (
    cause: ApplicationFailure | StalePlanError,
  ): Effect.fn.Return<never, ApplicationFailure | StalePlanError> {
    const failures: Array<ApplicationOperationFailure> = []
    for (const target of written) {
      const failure = yield* attempt(
        "rollback",
        "remove",
        target,
        fs.remove(target, { force: true }),
      )
      if (failure !== undefined) failures.push(failure)
    }
    for (const { target, backup } of backups.toReversed()) {
      if (written.has(target)) continue
      const failure = yield* attempt("rollback", "restore", target, fs.rename(backup, target))
      if (failure !== undefined) failures.push(failure)
    }
    for (const temporary of temporaries) {
      const failure = yield* attempt(
        "rollback",
        "cleanup-temporary",
        temporary,
        fs.remove(temporary, { force: true }),
      )
      if (failure !== undefined) failures.push(failure)
    }
    if (failures.length > 0) {
      return yield* new ApplicationFailure({
        planId: plan.planId,
        reason: "recovery",
        cause,
        failures,
      })
    }
    return yield* Effect.fail(cause)
  })
  const write = Effect.fn(function* (
    file: FilePreview,
    target: string,
    bytes: Uint8Array,
    mode: number | undefined,
  ) {
    yield* confinedTarget(file)
    yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.mapError(failed))
    yield* confinedTarget(file)
    const temporary = `${target}.safemods-${randomUUID()}.tmp`
    temporaries.add(temporary)
    yield* fs.writeFile(temporary, bytes, { flag: "wx", mode }).pipe(Effect.mapError(failed))
    yield* confinedTarget(file)
    yield* fs.rename(temporary, target).pipe(Effect.mapError(failed))
    temporaries.delete(temporary)
    written.add(target)
  })
  const commit = Effect.gen(function* () {
    for (const { file, target } of targets) {
      yield* confinedTarget(file)
      yield* requireUnchanged(file, target)
      if (!file.before.exists) continue
      const backup = `${target}.safemods-${randomUUID()}.backup`
      yield* fs.rename(target, backup).pipe(Effect.mapError(failed))
      backups.push({ target, backup })
    }
    for (const { file, target, mode } of targets) {
      yield* confinedTarget(file)
      yield* requireUnchanged(
        { ...file, before: file.before.exists ? { exists: false } : file.before },
        target,
      )
      if (file.after.exists) yield* write(file, target, file.after.bytes, mode)
    }
  })
  yield* commit.pipe(Effect.catch(rollback))

  const cleanupFailures: Array<ApplicationOperationFailure> = []
  for (const { backup } of backups) {
    const failure = yield* attempt(
      "cleanup",
      "cleanup-backup",
      backup,
      fs.remove(backup, { force: true }),
    )
    if (failure !== undefined) cleanupFailures.push(failure)
  }
  if (cleanupFailures.length > 0) {
    return yield* new ApplicationFailure({
      planId: plan.planId,
      reason: "recovery",
      failures: cleanupFailures,
    })
  }

  return {
    planId: plan.planId,
    written: preview.files.filter((file) => file.after.exists),
    removed: preview.files.filter((file) => !file.after.exists),
  } satisfies ApplicationReceipt
})
