import { Effect, Order } from "effect"
import { applyFileEdits } from "../Edit.ts"
import { type Contents, InvalidProposal } from "./Changes.ts"
import type { Proposal } from "../Proposal.ts"
import type * as WorkspacePath from "../WorkspacePath.ts"

export type FileState =
  | { readonly exists: false }
  | { readonly exists: true; readonly text: string; readonly bytes: Uint8Array }

export interface FilePreview {
  readonly fileName: WorkspacePath.Type
  readonly before: FileState
  readonly after: FileState
  readonly movedFrom?: WorkspacePath.Type
}

export interface MigrationPreview {
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
  plan: Proposal,
  contents: Contents,
): Effect.Effect<MigrationPreview, InvalidProposal> =>
  Effect.gen(function* () {
    const after = new Map(contents)
    for (const [fileName, edits] of Map.groupBy(plan.edits, (edit) => edit.fileName)) {
      const original = contents.get(fileName)
      if (original === undefined) {
        return yield* new InvalidProposal({ detail: `Missing source ${fileName}` })
      }
      const text = yield* Effect.try(() => decoder.decode(original)).pipe(
        Effect.mapError(() => new InvalidProposal({ detail: `Invalid UTF-8 in ${fileName}` })),
      )
      const edited = yield* applyFileEdits(text, edits).pipe(
        Effect.mapError(({ _tag }) => new InvalidProposal({ detail: `${_tag} in ${fileName}` })),
      )
      const hasByteOrderMark = original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf
      after.set(fileName, encoder.encode((hasByteOrderMark ? "\uFEFF" : "") + edited))
    }

    const changed = new Set<WorkspacePath.Type>(plan.edits.map((edit) => edit.fileName))
    const movedFrom = new Map<WorkspacePath.Type, WorkspacePath.Type>()
    for (const operation of plan.fileOperations) {
      const from = operation.fileName
      changed.add(from)
      if (operation.kind === "create") after.set(from, encoder.encode(operation.content))
      if (operation.kind === "delete") after.set(from, undefined)
      if (operation.kind === "move") {
        const to = operation.toFileName
        after.set(to, after.get(from))
        after.set(from, undefined)
        movedFrom.set(to, from)
        changed.add(to)
      }
    }

    const toPreview = (fileName: WorkspacePath.Type): FilePreview => ({
      fileName,
      before: stateOf(contents.get(fileName)),
      after: stateOf(after.get(fileName)),
      ...(movedFrom.has(fileName) ? { movedFrom: movedFrom.get(fileName)! } : {}),
    })
    return yield* Effect.try({
      try: () => ({
        sources: [...contents.keys()].map(toPreview),
        files: [...changed].sort(Order.String).map(toPreview).filter(({ before, after }) =>
          before.exists && after.exists ?
            before.bytes.length !== after.bytes.length ||
            before.bytes.some((byte, index) => byte !== after.bytes[index]) :
            before.exists !== after.exists
        ),
      }),
      catch: (cause) => new InvalidProposal({ detail: `Invalid UTF-8: ${String(cause)}` }),
    })
  })
