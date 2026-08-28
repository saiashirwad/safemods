/** Read-only materialization of a plan's exact proposed bytes. */
import { Effect, type FileSystem, type Path } from "effect"
import { sha256 } from "../Edit/index.ts"
import {
  isContentFingerprint,
  type PlanDecodeError,
  type ValidatedPlan,
  validatePlan,
  type TransformationPlan,
} from "../Plan/index.ts"
import { type ProjectIdentityMismatch, StalePlanError, VerificationFailure } from "./Errors.ts"
import {
  absoluteTarget,
  requireMatchingProjectIdentity,
  revalidateSource,
} from "./SourceRevalidation.ts"
import {
  materialize as materializeVirtualFs,
  virtualFileKey,
  type VirtualFsInitialFile,
  VirtualFsError,
} from "../VirtualFs/index.ts"
import { Workspace } from "../Workspace/index.ts"

export type FileState =
  | { readonly exists: false; readonly text?: undefined; readonly hash?: undefined }
  | { readonly exists: true; readonly text: string; readonly hash: string }

export interface FilePreview {
  readonly projectId: string
  readonly fileName: string
  /** Explicit operation and virtual existence state; empty text is valid content. */
  readonly action: "create" | "modify" | "delete" | "move"
  readonly before: FileState
  readonly after: FileState
  /** The counterpart path for a move operation, when applicable. */
  readonly movePath?: string | undefined
}

export interface PlanPreview {
  readonly planId: string
  readonly snapshotHash: string
  readonly files: ReadonlyArray<FilePreview>
}

/** Materialize a plan that has already crossed a validation boundary. */
export const previewValidatedPlan = (
  plan: ValidatedPlan,
  workspaceRoot: string,
): Effect.Effect<
  PlanPreview,
  StalePlanError | VerificationFailure,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const initialFiles: Array<VirtualFsInitialFile> = []
    const initial = new Map<string, string>()
    for (const source of plan.sources) {
      const content = yield* revalidateSource(plan, workspaceRoot, source)
      if (!isContentFingerprint(source) || content === undefined) continue
      initialFiles.push({
        projectId: source.projectId,
        fileName: source.fileName,
        content,
      })
      initial.set(virtualFileKey(source.projectId, source.fileName), content)
    }

    const absoluteTargets = new Map<string, string>()
    const targetPaths = new Map<string, readonly [projectId: string, fileName: string]>()
    const addTarget = (projectId: string, fileName: string): void => {
      targetPaths.set(virtualFileKey(projectId, fileName), [projectId, fileName])
    }
    for (const source of plan.sources) addTarget(source.projectId, source.fileName)
    for (const edit of plan.edits) addTarget(edit.projectId, edit.fileName)
    for (const operation of plan.fileOperations ?? []) {
      addTarget(operation.projectId, operation.path)
      if (operation.kind === "move") addTarget(operation.projectId, operation.toPath)
    }
    for (const [key, [projectId, fileName]] of targetPaths) {
      absoluteTargets.set(key, yield* absoluteTarget(plan, workspaceRoot, projectId, fileName))
    }
    const resolvePath = (projectId: string, fileName: string): string =>
      // SAFETY: every materializer input path is collected above.
      absoluteTargets.get(virtualFileKey(projectId, fileName))!

    const materialized = yield* materializeVirtualFs<VerificationFailure>({
      initialFiles,
      load: (projectId, fileName) =>
        Effect.fail(
          new VerificationFailure({
            planId: plan.planId,
            policy: "edits",
            detail: `Missing fingerprint for ${virtualFileKey(projectId, fileName)}`,
          }),
        ),
      resolvePath,
      edits: plan.edits,
      fileOperations: plan.fileOperations,
    }).pipe(
      Effect.mapError((error) => {
        if (error instanceof VerificationFailure) return error
        if (error instanceof VirtualFsError) {
          if (error.reason === "source-mismatch") {
            return new StalePlanError({
              planId: plan.planId,
              projectId: error.projectId,
              fileName: error.fileName,
            })
          }
          return new VerificationFailure({
            planId: plan.planId,
            policy: "edits",
            detail: `Missing source for ${virtualFileKey(error.projectId, error.fileName)}`,
          })
        }
        return new VerificationFailure({
          planId: plan.planId,
          policy: "edits",
          detail: error._tag,
        })
      }),
    )

    const touched = new Set<string>()
    const moveCounterpart = new Map<string, string>()
    const operationKinds = new Map<string, "create" | "delete" | "move">()
    for (const operation of plan.fileOperations ?? []) {
      const sourceKey = virtualFileKey(operation.projectId, operation.path)
      touched.add(sourceKey)
      if (operation.kind === "create") {
        operationKinds.set(sourceKey, "create")
      } else if (operation.kind === "delete") {
        operationKinds.set(sourceKey, "delete")
      } else {
        const targetKey = virtualFileKey(operation.projectId, operation.toPath)
        touched.add(targetKey)
        operationKinds.set(sourceKey, "move")
        operationKinds.set(targetKey, "move")
        moveCounterpart.set(sourceKey, operation.toPath)
        moveCounterpart.set(targetKey, operation.path)
      }
    }

    for (const edit of plan.edits) {
      touched.add(virtualFileKey(edit.projectId, edit.fileName))
    }

    const filesByKey = new Map<string, FilePreview>()
    const stateOf = (text: string | undefined): FileState =>
      text === undefined ? { exists: false } : { exists: true, text, hash: sha256(text) }
    for (const key of touched) {
      // SAFETY: every virtualFileKey is created from exactly one project ID and file name.
      const [projectId, fileName] = key.split("\0") as [string, string]
      const absolute = resolvePath(projectId, fileName)
      const before = initial.get(key)
      const after = materialized.deleted.has(absolute)
        ? undefined
        : materialized.files.get(absolute)
      const operation = operationKinds.get(key)
      const action = operation ?? (before === undefined ? "create" : "modify")
      filesByKey.set(key, {
        projectId,
        fileName,
        action,
        before: stateOf(before),
        after: stateOf(after),
        movePath: moveCounterpart.get(key),
      })
    }

    const files = [...filesByKey.values()]
    files.sort(
      (left, right) =>
        left.projectId.localeCompare(right.projectId) ||
        left.fileName.localeCompare(right.fileName),
    )
    return { planId: plan.planId, snapshotHash: plan.snapshotHash, files }
  })

/** Validate and materialize a plan against an explicit workspace root. */
export const previewPlan = (
  plan: TransformationPlan,
  workspaceRoot: string,
): Effect.Effect<
  PlanPreview,
  StalePlanError | VerificationFailure | PlanDecodeError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const validated = yield* validatePlan(plan)
    return yield* previewValidatedPlan(validated, workspaceRoot)
  })

/** Materialize a validated preview against the active Workspace. Never writes. */
export const of = (
  plan: TransformationPlan,
): Effect.Effect<
  PlanPreview,
  StalePlanError | VerificationFailure | PlanDecodeError | ProjectIdentityMismatch,
  Workspace | FileSystem.FileSystem | Path.Path
> =>
  Workspace.use((workspace) =>
    Effect.gen(function* () {
      const validated = yield* validatePlan(plan)
      yield* requireMatchingProjectIdentity(validated, workspace.definition.projects)
      return yield* previewValidatedPlan(validated, workspace.root)
    }),
  )
