import { Effect, Order } from "effect"
import { applyFileEdits } from "../Edit.ts"
import * as FileRef from "../FileRef.ts"
import { type Contents, InvalidPlan, type Plan, targetOf } from "../Plan.ts"
import type * as ProjectRelativePath from "../ProjectRelativePath.ts"

export type FileState =
  | { readonly exists: false }
  | { readonly exists: true; readonly text: string; readonly bytes: Uint8Array }

export interface FilePreview extends FileRef.FileRef {
  readonly before: FileState
  readonly after: FileState
  readonly movedFrom?: ProjectRelativePath.Type
}

export interface PlanPreview {
  readonly sources: ReadonlyArray<FilePreview>
  readonly files: ReadonlyArray<FilePreview>
}

export const actionOf = ({ before, after }: FilePreview): "create" | "modify" | "delete" =>
  before.exists ? (after.exists ? "modify" : "delete") : "create"

const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()

const stateOf = (bytes: Uint8Array | undefined): FileState =>
  bytes === undefined ? { exists: false } : { exists: true, text: decoder.decode(bytes), bytes }

export const previewOf = (
  plan: Plan,
  contents: Contents,
): Effect.Effect<PlanPreview, InvalidPlan> =>
  Effect.gen(function* () {
    const before = new Map(
      [...FileRef.entries(contents)].map(([file, bytes]) => [FileRef.key(file), bytes]),
    )
    const after = new Map(before)
    for (const [key, edits] of Map.groupBy(plan.edits, FileRef.key)) {
      const { fileName } = edits[0]!
      const original = before.get(key)
      if (original === undefined) {
        return yield* new InvalidPlan({ detail: `Missing source ${fileName}` })
      }
      const text = yield* Effect.try(() => decoder.decode(original)).pipe(
        Effect.mapError(() => new InvalidPlan({ detail: `Invalid UTF-8 in ${fileName}` })),
      )
      const edited = yield* applyFileEdits(text, edits).pipe(
        Effect.mapError(({ _tag }) => new InvalidPlan({ detail: `${_tag} in ${fileName}` })),
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
        const to = FileRef.key(targetOf(operation))
        after.set(to, after.get(from))
        after.set(from, undefined)
        movedFrom.set(to, operation.fileName)
        changed.push(targetOf(operation))
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
      sources: [...FileRef.entries(contents)].map(([file]) => toPreview(file)),
      files: [...files.values()].sort(
        Order.Struct({ projectId: Order.String, fileName: Order.String }),
      ),
    }
  })
