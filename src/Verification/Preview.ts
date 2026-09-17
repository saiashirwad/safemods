import { Effect, FileSystem, Order } from "effect"
import { applyFileEdits } from "../Edit.ts"
import * as FileRef from "../FileRef.ts"
import {
  type InvalidPlan,
  type SourceFingerprint,
  type TransformationPlan,
  type ValidatedPlan,
  validatePlan,
} from "../Plan.ts"
import * as Sha256 from "../Sha256.ts"
import { Workspace } from "../Workspace/index.ts"
import { PlanContextMismatch, StalePlanError } from "./Errors.ts"

export type FileState =
  | { readonly exists: false }
  | { readonly exists: true; readonly text: string }

export interface FilePreview extends FileRef.FileRef {
  readonly before: FileState
  readonly after: FileState
}

export interface PlanPreview {
  readonly planId: Sha256.Type
  readonly files: ReadonlyArray<FilePreview>
}

const stateOf = (text: string | undefined): FileState =>
  text === undefined ? { exists: false } : { exists: true, text }

export const requireWorkspaceProjects = (
  plan: TransformationPlan,
): Effect.Effect<void, PlanContextMismatch, Workspace> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const live = workspace.definition.projects.map(({ id, config }) => `${id}\0${config}`)
    const planned = plan.projects.map(({ id, configFileName }) => `${id}\0${configFileName}`)
    if (live.sort().join("\n") !== planned.sort().join("\n")) {
      return yield* new PlanContextMismatch({ planId: plan.planId, field: "workspace" })
    }
  })

const readSource = (plan: ValidatedPlan, source: SourceFingerprint) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const workspace = yield* Workspace
    const absolute = workspace.absolutePath(source)
    const { projectId, fileName } = source
    const stale = new StalePlanError({ planId: plan.planId, projectId, fileName })
    if (source.kind === "missing") {
      const exists = yield* fs.exists(absolute).pipe(Effect.mapError(() => stale))
      return exists ? yield* stale : undefined
    }
    const text = yield* fs.readFileString(absolute).pipe(Effect.mapError(() => stale))
    return Sha256.digest(text) === source.hash ? text : yield* stale
  })

export const previewValidated = (
  plan: ValidatedPlan,
): Effect.Effect<PlanPreview, StalePlanError, Workspace | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const before = new Map<string, string | undefined>()
    for (const source of plan.sources) {
      before.set(FileRef.key(source), yield* readSource(plan, source))
    }

    const after = new Map(before)
    for (const [key, edits] of Map.groupBy(plan.edits, FileRef.key)) {
      const edited = yield* applyFileEdits(before.get(key)!, edits).pipe(Effect.orDie)
      after.set(key, edited)
    }

    const changed: Array<FileRef.FileRef> = [...plan.edits, ...plan.fileOperations]
    for (const operation of plan.fileOperations) {
      const from = FileRef.key(operation)
      if (operation.kind === "create") after.set(from, operation.content)
      if (operation.kind === "delete") after.set(from, undefined)
      if (operation.kind === "move") {
        const to = { projectId: operation.projectId, fileName: operation.toFileName }
        after.set(FileRef.key(to), after.get(from))
        after.set(from, undefined)
        changed.push(to)
      }
    }

    const files = new Map(
      changed.map(({ projectId, fileName }) => {
        const key = FileRef.key({ projectId, fileName })
        const file = {
          projectId,
          fileName,
          before: stateOf(before.get(key)),
          after: stateOf(after.get(key)),
        }
        return [key, file]
      }),
    )
    return {
      planId: plan.planId,
      files: [...files.values()].sort(
        Order.Struct({ projectId: Order.String, fileName: Order.String }),
      ),
    }
  })

export const preview = (
  plan: TransformationPlan,
): Effect.Effect<
  PlanPreview,
  InvalidPlan | PlanContextMismatch | StalePlanError,
  Workspace | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const validated = yield* validatePlan(plan)
    yield* requireWorkspaceProjects(validated)
    return yield* previewValidated(validated)
  })
