import { randomUUID } from "node:crypto"
import { Effect, FileSystem, Path } from "effect"
import type { ApplicationReceipt } from "../Application.ts"
import { sha256 } from "../../Edit/index.ts"
import { StalePlanError } from "../../Verification/Errors.ts"
import { previewValidatedPlan } from "../../Verification/Preview.ts"
import { requireMatchingProjectIdentity } from "../../Verification/SourceRevalidation.ts"
import { isVerifiedPlan, type VerifiedPlan } from "../../Verification/VerifiedPlan.ts"
import { Workspace } from "../../Workspace/index.ts"
import { preserveStalePlanError, toApplicationFailure } from "./Failure.ts"
import { safeTarget } from "./PathSafety.ts"

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

  const preview = yield* previewValidatedPlan(plan, workspaceRoot).pipe(
    Effect.mapError(preserveStalePlanError(plan.planId)),
  )

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
