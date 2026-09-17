import { randomUUID } from "node:crypto"
import { Data, Effect, FileSystem, Path } from "effect"
import type * as Sha256 from "./Sha256.ts"
import { type FilePreview, StalePlanError, type VerifiedPlan } from "./Verification/index.ts"
import { isIssued } from "./Verification/VerifiedPlan.ts"

export class ApplicationFailure extends Data.TaggedError("ApplicationFailure")<{
  readonly planId: string
  readonly cause: unknown
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
    return yield* new ApplicationFailure({
      planId: "unissued",
      cause: "Verified plan was not issued by verification",
    })
  }
  const { workspace, plan, preview } = verified
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const failed = (cause: unknown) => new ApplicationFailure({ planId: plan.planId, cause })

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
      return yield* failed(`Path escapes its project through a symlink: ${file.fileName}`)
    }
    return target
  })

  const requireUnchanged = Effect.fn(function* (file: FilePreview, target: string) {
    const { projectId, fileName } = file
    const stale = new StalePlanError({ planId: plan.planId, projectId, fileName })
    const exists = yield* fs.exists(target).pipe(Effect.mapError(failed))
    if (exists !== file.before.exists) return yield* stale
    if (!file.before.exists) return { mode: undefined, byteOrderMark: "" }
    const bytes = yield* fs.readFile(target).pipe(Effect.mapError(failed))
    if (new TextDecoder().decode(bytes) !== file.before.text) return yield* stale
    const { mode } = yield* fs.stat(target).pipe(Effect.mapError(failed))
    const hasByteOrderMark = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    return { mode, byteOrderMark: hasByteOrderMark ? "\uFEFF" : "" }
  })

  const write = (target: string, text: string, mode: number | undefined) => {
    const temporary = `${target}.safemods-${randomUUID()}.tmp`
    return fs
      .makeDirectory(path.dirname(target), { recursive: true })
      .pipe(
        Effect.andThen(fs.writeFileString(temporary, text, { flag: "wx", mode })),
        Effect.andThen(fs.rename(temporary, target)),
        Effect.ensuring(Effect.ignore(fs.remove(temporary, { force: true }))),
        Effect.mapError(failed),
      )
  }

  const checked = []
  for (const file of preview.files) {
    const target = yield* confinedTarget(file)
    checked.push({ file, target, existing: yield* requireUnchanged(file, target) })
  }
  for (const { file, target, existing } of checked) {
    yield* file.after.exists
      ? write(target, existing.byteOrderMark + file.after.text, existing.mode)
      : fs.remove(target, { force: true }).pipe(Effect.mapError(failed))
  }

  const receipt: ApplicationReceipt = {
    planId: plan.planId,
    written: preview.files.filter((file) => file.after.exists),
    removed: preview.files.filter((file) => !file.after.exists),
  }
  return receipt
})
