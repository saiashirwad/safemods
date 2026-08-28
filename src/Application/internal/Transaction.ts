import { randomUUID } from "node:crypto"
import { Effect, FileSystem, Path } from "effect"
import { ApplicationIndeterminate } from "../../Application/Application.ts"
import type { TransformationPlan } from "../../Plan/index.ts"
import { StalePlanError } from "../../Verification/Errors.ts"
import { previewValidatedPlan } from "../../Verification/Preview.ts"
import { requireMatchingProjectIdentity } from "../../Verification/SourceRevalidation.ts"
import { isVerifiedPlan, type VerifiedPlan } from "../../Verification/VerifiedPlan.ts"
import { Workspace } from "../../Workspace/index.ts"
import { preserveStalePlanError, toApplicationFailure } from "./Failure.ts"
import { withExclusiveApplyLock } from "./Lock.ts"
import { safeTarget } from "./PathSafety.ts"
import {
  APPLY_JOURNAL_NAME,
  persistJournal,
  recoverUnfinishedApplication,
  type JournalBeforeState,
  type JournalEntry,
  type TransactionJournal,
} from "./Recovery.ts"
import {
  checkExpectedState,
  installExistingFile,
  stagePreviewFiles,
  type StagedFile,
} from "./Stage.ts"

const journalEntry = (item: StagedFile): JournalEntry => {
  const before: JournalBeforeState = item.file.before.exists
    ? { exists: true, text: item.file.before.text }
    : { exists: false }
  return item.temporary === undefined
    ? { target: item.target, before }
    : { target: item.target, temporary: item.temporary, before }
}

const rollbackAppliedFiles = (
  plan: TransformationPlan,
  workspaceRoot: string,
  applied: ReadonlyArray<StagedFile>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    for (const item of [...applied].reverse()) {
      const target = yield* safeTarget(plan, workspaceRoot, item.file.projectId, item.file.fileName)
      if (!item.file.before.exists) {
        yield* fs.remove(target, { force: true })
      } else {
        const rollbackTemporary = `${target}.safemods-rollback-${randomUUID()}.tmp`
        yield* Effect.gen(function* () {
          yield* fs.writeFileString(rollbackTemporary, item.file.before.text ?? "", {
            flag: "wx",
          })
          yield* fs.rename(rollbackTemporary, target)
        }).pipe(Effect.ensuring(fs.remove(rollbackTemporary, { force: true }).pipe(Effect.ignore)))
      }
    }
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
  return yield* withExclusiveApplyLock(
    workspaceRoot,
    plan.planId,
    Effect.gen(function* () {
      yield* recoverUnfinishedApplication(workspaceRoot, plan.planId)
      const preview = yield* previewValidatedPlan(plan, workspaceRoot).pipe(
        Effect.mapError(preserveStalePlanError(plan.planId)),
      )
      const staged: Array<StagedFile> = []
      const applied: Array<StagedFile> = []
      const createdDirectories: Array<string> = []
      let committed = false

      const cleanup = Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        for (const item of staged) {
          if (item.temporary !== undefined) {
            yield* fs.remove(item.temporary, { force: true }).pipe(Effect.ignore)
          }
        }
        if (!committed) {
          for (const directory of [...createdDirectories].reverse()) {
            yield* fs.remove(directory, { force: true }).pipe(Effect.ignore)
          }
        }
      })

      return yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const stageExit = yield* stagePreviewFiles(
          plan,
          workspaceRoot,
          preview.files,
          staged,
          createdDirectories,
        ).pipe(Effect.result)

        if (stageExit._tag === "Failure") return yield* stageExit.failure

        const journalPath = path.join(workspaceRoot, APPLY_JOURNAL_NAME)
        const journal: TransactionJournal = {
          planId: plan.planId,
          phase: "open",
          files: staged.map(journalEntry),
          createdDirectories: [...createdDirectories],
        }
        yield* persistJournal(journalPath, journal)

        const commitExit = yield* Effect.gen(function* () {
          for (const item of staged) {
            yield* checkExpectedState(plan, workspaceRoot, item.file)
            if (!item.file.after.exists) {
              yield* fs.remove(item.target)
              applied.push(item)
            } else {
              yield* item.file.before.exists
                ? installExistingFile(plan, item.file, item.temporary!, item.target)
                : fs.link(item.temporary!, item.target)
              applied.push(item)
              yield* fs.remove(item.temporary!, { force: true }).pipe(Effect.ignore)
            }
          }
        }).pipe(Effect.mapError(preserveStalePlanError(plan.planId)), Effect.result)

        if (commitExit._tag === "Failure") {
          const rollbackExit = yield* rollbackAppliedFiles(plan, workspaceRoot, applied).pipe(
            Effect.result,
          )

          if (rollbackExit._tag === "Failure") {
            return yield* new ApplicationIndeterminate({
              planId: plan.planId,
              cause: commitExit.failure,
              rollbackCause: rollbackExit.failure,
            })
          }
          yield* fs.remove(journalPath, { force: true }).pipe(Effect.ignore)
          if (commitExit.failure instanceof StalePlanError) return yield* commitExit.failure
          return yield* toApplicationFailure(plan.planId, commitExit.failure.cause, true)
        }

        yield* persistJournal(journalPath, { ...journal, phase: "committed" })
        yield* fs
          .remove(journalPath, { force: true })
          .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId, cause)))
        committed = true
        return {
          planId: plan.planId,
          snapshotHash: plan.snapshotHash,
          outputs: preview.files.map((file) => ({
            projectId: file.projectId,
            fileName: file.fileName,
            hash: file.after.hash ?? "",
          })),
        }
      }).pipe(Effect.ensuring(cleanup))
    }),
  )
})
