/** Apply a verified plan to the real filesystem. */
import { randomUUID } from "node:crypto"
import { Data, Effect, FileSystem, Path } from "effect"
import { sha256 } from "./Edit.ts"
import type { TransformationPlan } from "./Plan/index.ts"
import { isPathContained, resolvePlanFilePath, unsafePlanFilePathMessage } from "./ProjectPath.ts"
import { StalePlanError } from "./Verification/Errors.ts"
import { requireMatchingProjectIdentity } from "./Verification/SourceRevalidation.ts"
import { isVerifiedPlan, type VerifiedPlan } from "./Verification/VerifiedPlan.ts"
import { Workspace } from "./Workspace/index.ts"

export class ApplicationFailure extends Data.TaggedError("ApplicationFailure")<{
  readonly planId: string
  readonly cause: unknown
}> {}

export interface ApplicationReceipt {
  readonly planId: string
  readonly snapshotHash: string
  readonly outputs: ReadonlyArray<{
    readonly projectId: string
    readonly fileName: string
    readonly hash: string
  }>
}

const toApplicationFailure = (planId: string, cause: unknown): ApplicationFailure =>
  new ApplicationFailure({ planId, cause })

const safeTarget = (
  plan: TransformationPlan,
  workspaceRoot: string,
  projectId: string,
  fileName: string,
): Effect.Effect<string, ApplicationFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const resolved = resolvePlanFilePath(path, plan, workspaceRoot, projectId, fileName)
    if (resolved === undefined) {
      return yield* toApplicationFailure(
        plan.planId,
        unsafePlanFilePathMessage(projectId, fileName),
      )
    }
    const root = path.resolve(workspaceRoot)
    const { projectRoot, fileName: target } = resolved

    const realProjectRoot = yield* fs
      .realPath(projectRoot)
      .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))
    const realWorkspaceRoot = yield* fs
      .realPath(root)
      .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))
    if (!isPathContained(path, realWorkspaceRoot, realProjectRoot, { includeRoot: true })) {
      return yield* toApplicationFailure(
        plan.planId,
        `Project root escapes workspace through symlink: ${projectId}`,
      )
    }
    let existingParent = path.dirname(target)
    while (
      !(yield* fs
        .exists(existingParent)
        .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause))))
    ) {
      if (existingParent === projectRoot) break
      const parent = path.dirname(existingParent)
      if (parent === existingParent || !isPathContained(path, projectRoot, parent)) {
        return yield* toApplicationFailure(
          plan.planId,
          `Path escapes project through parent: ${fileName}`,
        )
      }
      existingParent = parent
    }
    const realParent = yield* fs
      .realPath(existingParent)
      .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))
    if (!isPathContained(path, realProjectRoot, realParent, { includeRoot: true })) {
      return yield* toApplicationFailure(
        plan.planId,
        `Path escapes project through symlink: ${fileName}`,
      )
    }

    const targetExists = yield* fs
      .exists(target)
      .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))
    if (targetExists) {
      const realTarget = yield* fs
        .realPath(target)
        .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))
      if (!isPathContained(path, realProjectRoot, realTarget)) {
        return yield* toApplicationFailure(
          plan.planId,
          `Target escapes project through symlink: ${fileName}`,
        )
      }
    }
    return target
  })

export const applyVerifiedPlan = Effect.fn("Application.applyVerifiedPlan")(function* (
  verified: VerifiedPlan,
) {
  const workspace = yield* Workspace
  const workspaceRoot = workspace.root
  const definition = workspace.definition
  if (!isVerifiedPlan(verified)) {
    return yield* toApplicationFailure("unissued", "Verified plan was not issued by verification")
  }
  const plan = verified.plan
  yield* requireMatchingProjectIdentity(plan, definition.projects)

  const preview = verified.preview

  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  // Preflight state checks for all files in preview
  for (const file of preview.files) {
    const target = yield* safeTarget(plan, workspaceRoot, file.projectId, file.fileName)
    const exists = yield* fs
      .exists(target)
      .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))
    if (exists !== file.before.exists) {
      return yield* new StalePlanError({
        planId: plan.planId,
        projectId: file.projectId,
        fileName: file.fileName,
      })
    }
    if (exists && file.before.hash !== undefined) {
      const text = yield* fs
        .readFileString(target)
        .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))
      if (sha256(text) !== file.before.hash) {
        return yield* new StalePlanError({
          planId: plan.planId,
          projectId: file.projectId,
          fileName: file.fileName,
        })
      }
    }
  }

  // Atomic file writes
  for (const file of preview.files) {
    const target = yield* safeTarget(plan, workspaceRoot, file.projectId, file.fileName)
    if (!file.after.exists) {
      yield* fs
        .remove(target, { force: true })
        .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))
    } else {
      const parentDir = path.dirname(target)
      yield* fs
        .makeDirectory(parentDir, { recursive: true })
        .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))

      const tempFile = `${target}.safemods-tmp-${randomUUID()}.tmp`
      const text = file.after.text
      yield* fs
        .writeFileString(tempFile, text, { flag: "wx" })
        .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))

      yield* fs.rename(tempFile, target).pipe(
        Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)),
        Effect.ensuring(fs.remove(tempFile, { force: true }).pipe(Effect.ignore)),
      )
    }
  }

  const receipt: ApplicationReceipt = {
    planId: plan.planId,
    snapshotHash: plan.snapshotHash,
    outputs: preview.files.map((file) => ({
      projectId: file.projectId,
      fileName: file.fileName,
      hash: file.after.hash ?? "",
    })),
  }
  return receipt
})
