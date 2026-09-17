import { Effect, FileSystem, Order, type PlatformError, Schema } from "effect"
import { applyFileEdits } from "../Edit.ts"
import * as FileRef from "../FileRef.ts"
import {
  InvalidPlan,
  type SourceFingerprint,
  type TransformationPlan,
  type ValidatedPlan,
  validatePlan,
} from "../Plan.ts"
import type * as ProjectRelativePath from "../ProjectRelativePath.ts"
import * as Sha256 from "../Sha256.ts"
import { type ProjectNotInWorkspace, Workspace } from "../Workspace/index.ts"
import { PlanContextMismatch, StalePlanError } from "./Errors.ts"

export type FileState =
  | { readonly exists: false }
  | { readonly exists: true; readonly text: string; readonly bytes: Uint8Array }

export interface FilePreview extends FileRef.FileRef {
  readonly before: FileState
  readonly after: FileState
  readonly movedFrom?: ProjectRelativePath.Type
}

export interface PlanPreview {
  readonly planId: Sha256.Type
  readonly sources: ReadonlyArray<FilePreview>
  readonly files: ReadonlyArray<FilePreview>
}

const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()
const stateOf = (bytes: Uint8Array | undefined): FileState => {
  if (bytes === undefined) return { exists: false }
  const snapshot = Uint8Array.from(bytes)
  return {
    exists: true,
    text: decoder.decode(snapshot),
    get bytes() {
      return Uint8Array.from(snapshot)
    },
  }
}

const workspaceProjects = Schema.Array(
  Schema.Struct({ projectId: Schema.String, configFileName: Schema.String }),
)
const workspaceProjectsEquivalent = Schema.toEquivalence(workspaceProjects)

export const requireWorkspaceProjects = (
  plan: TransformationPlan,
): Effect.Effect<void, PlanContextMismatch, Workspace> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const byProject = Order.Struct({ projectId: Order.String, configFileName: Order.String })
    const live = workspace.definition.projects
      .map(({ id, config }) => ({ projectId: id, configFileName: config }))
      .sort(byProject)
    const planned = plan.projects
      .map(({ id, configFileName }) => ({ projectId: id, configFileName }))
      .sort(byProject)
    if (!workspaceProjectsEquivalent(live, planned)) {
      return yield* new PlanContextMismatch({ planId: plan.planId, field: "workspace" })
    }
  })

const readSource = (plan: ValidatedPlan, source: SourceFingerprint) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const workspace = yield* Workspace
    const absolute = yield* workspace.absolutePath(source)
    const { projectId, fileName } = source
    const stale = new StalePlanError({ planId: plan.planId, projectId, fileName })
    if (source.kind === "missing") {
      const exists = yield* fs
        .exists(absolute)
        .pipe(
          Effect.mapError((cause): PlatformError.PlatformError | StalePlanError =>
            cause.reason._tag === "NotFound" ? stale : cause,
          ),
        )
      return exists ? yield* stale : undefined
    }
    const bytes = yield* fs
      .readFile(absolute)
      .pipe(
        Effect.mapError((cause): PlatformError.PlatformError | StalePlanError =>
          cause.reason._tag === "NotFound" ? stale : cause,
        ),
      )
    return Sha256.digest(bytes) === source.hash ? bytes : yield* stale
  })

const invalidReplayPlan = (detail: string) => new InvalidPlan({ phase: "build", detail })

export const previewCaptured = (
  plan: ValidatedPlan,
  captured: FileRef.ReadonlyMap<Uint8Array | undefined>,
): Effect.Effect<PlanPreview, InvalidPlan> =>
  Effect.gen(function* () {
    const before = new Map(
      [...FileRef.entries(captured)].map(([file, bytes]) => [
        FileRef.key(file),
        bytes === undefined ? undefined : Uint8Array.from(bytes),
      ]),
    )
    const after = new Map(before)
    for (const [key, edits] of Map.groupBy(plan.edits, FileRef.key)) {
      const original = before.get(key)
      if (original === undefined) {
        return yield* invalidReplayPlan(`Missing source in ${edits[0]!.fileName}`)
      }
      const text = yield* Effect.try(() => decoder.decode(original)).pipe(
        Effect.mapError(() => invalidReplayPlan(`Invalid UTF-8 in ${edits[0]!.fileName}`)),
      )
      const edited = yield* applyFileEdits(text, edits).pipe(
        Effect.mapError(({ _tag }) => invalidReplayPlan(`${_tag} in ${edits[0]!.fileName}`)),
      )
      const hasByteOrderMark = original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf
      after.set(key, encoder.encode((hasByteOrderMark ? "\uFEFF" : "") + edited))
    }

    const changed: Array<FileRef.FileRef> = [...plan.edits, ...plan.fileOperations]
    const movedFrom = new Map<string, ProjectRelativePath.Type>()
    for (const operation of plan.fileOperations) {
      const from = FileRef.key(operation)
      if (operation.kind === "create") after.set(from, encoder.encode(operation.content))
      if (operation.kind === "delete") after.set(from, undefined)
      if (operation.kind === "move") {
        const to = { projectId: operation.projectId, fileName: operation.toFileName }
        const toKey = FileRef.key(to)
        after.set(toKey, after.get(from))
        after.set(from, undefined)
        movedFrom.set(toKey, operation.fileName)
        changed.push(to)
      }
    }

    const toPreview = ({ projectId, fileName }: FileRef.FileRef): FilePreview => {
      const key = FileRef.key({ projectId, fileName })
      return {
        projectId,
        fileName,
        before: stateOf(before.get(key)),
        after: stateOf(after.get(key)),
        ...(movedFrom.has(key) ? { movedFrom: movedFrom.get(key)! } : {}),
      }
    }
    const files = new Map(changed.map((file) => [FileRef.key(file), toPreview(file)]))
    return {
      planId: plan.planId,
      sources: plan.sources.map(toPreview),
      files: [...files.values()].sort(
        Order.Struct({ projectId: Order.String, fileName: Order.String }),
      ),
    }
  })

export const previewValidated = (
  plan: ValidatedPlan,
): Effect.Effect<
  PlanPreview,
  InvalidPlan | ProjectNotInWorkspace | StalePlanError | PlatformError.PlatformError,
  Workspace | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const captured: FileRef.Map<Uint8Array | undefined> = new Map()
    for (const source of plan.sources) {
      FileRef.set(captured, source, yield* readSource(plan, source))
    }
    return yield* previewCaptured(plan, captured)
  })

export const preview = (
  plan: TransformationPlan,
): Effect.Effect<
  PlanPreview,
  | InvalidPlan
  | PlanContextMismatch
  | ProjectNotInWorkspace
  | StalePlanError
  | PlatformError.PlatformError,
  Workspace | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const validated = yield* validatePlan(plan)
    yield* requireWorkspaceProjects(validated)
    return yield* previewValidated(validated)
  })
