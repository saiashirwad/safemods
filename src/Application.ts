import { randomUUID } from "node:crypto"
import { Data, Effect, FileSystem, Path } from "effect"
import * as Sha256 from "./Sha256.ts"
import { type FilePreview, StalePlanError, type VerifiedPlan } from "./Verification/index.ts"
import { isIssued } from "./Verification/VerifiedPlan.ts"

export class ApplicationFailure extends Data.TaggedError("ApplicationFailure")<{
  readonly planId: string
  readonly reason: "unissued" | "path-escape" | "filesystem"
  readonly cause?: unknown
}> {}

export interface ApplicationReceipt {
  readonly planId: Sha256.Type
  readonly written: ReadonlyArray<FilePreview>
  readonly removed: ReadonlyArray<FilePreview>
}

export const applyVerifiedPlan = Effect.fn("Application.applyVerifiedPlan")(function* (
  verified: VerifiedPlan,
) {
  if (!isIssued(verified)) {
    return yield* new ApplicationFailure({ planId: "unissued", reason: "unissued" })
  }
  const { workspace, plan, preview } = verified
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const failed = (cause: unknown) =>
    new ApplicationFailure({ planId: plan.planId, reason: "filesystem", cause })

  const isWithin = (directory: string, candidate: string): boolean => {
    const relative = path.relative(directory, candidate)
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  }
  const nearestExisting = (target: string): Effect.Effect<string, ApplicationFailure> =>
    fs.exists(target).pipe(
      Effect.mapError(failed),
      Effect.flatMap((exists) =>
        exists ? Effect.succeed(target) : nearestExisting(path.dirname(target)),
      ),
    )
  const confinedTarget = Effect.fn(function* (file: FilePreview) {
    const target = workspace.absolutePath(file)
    const realWorkspace = yield* fs.realPath(workspace.root).pipe(Effect.mapError(failed))
    const realProject = yield* fs
      .realPath(workspace.projectRoot(file.projectId))
      .pipe(Effect.mapError(failed))
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
  const write = (target: string, bytes: Uint8Array, mode: number | undefined) => {
    const temporary = `${target}.safemods-${randomUUID()}.tmp`
    return fs
      .makeDirectory(path.dirname(target), { recursive: true })
      .pipe(
        Effect.andThen(fs.writeFile(temporary, bytes, { flag: "wx", mode })),
        Effect.andThen(fs.rename(temporary, target)),
        Effect.ensuring(Effect.ignore(fs.remove(temporary, { force: true }))),
        Effect.mapError(failed),
      )
  }

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
  for (const { file, target } of targets) {
    yield* requireUnchanged(file, target)
    if (!file.before.exists) continue
    const backup = `${target}.safemods-${randomUUID()}.backup`
    yield* fs.rename(target, backup).pipe(Effect.mapError(failed))
    backups.push({ target, backup })
  }
  const commit = Effect.gen(function* () {
    for (const { file, target, mode } of targets) {
      yield* requireUnchanged(
        { ...file, before: file.before.exists ? { exists: false } : file.before },
        target,
      )
      if (file.after.exists) yield* write(target, file.after.bytes, mode)
    }
  })
  yield* commit.pipe(
    Effect.catch((cause) =>
      Effect.gen(function* () {
        for (const { target } of targets)
          yield* fs.remove(target, { force: true }).pipe(Effect.ignore)
        for (const { target, backup } of backups) {
          yield* fs.rename(backup, target).pipe(Effect.ignore)
        }
        return yield* cause
      }),
    ),
  )
  for (const { backup } of backups) yield* fs.remove(backup, { force: true }).pipe(Effect.ignore)

  return {
    planId: plan.planId,
    written: preview.files.filter((file) => file.after.exists),
    removed: preview.files.filter((file) => !file.after.exists),
  } satisfies ApplicationReceipt
})
