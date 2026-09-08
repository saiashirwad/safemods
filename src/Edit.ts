/** Hash-guarded text edits: construction, validation, and application. */
import { hash } from "node:crypto"
import { Data, Effect } from "effect"

export const sha256 = (value: string): string => hash("sha256", value, "hex")

export interface TextEdit {
  readonly projectId: string
  readonly fileName: string
  readonly start: number
  readonly end: number
  readonly expectedTextHash: string
  readonly newText: string
  readonly evidenceIds: ReadonlyArray<string>
}

export const textEdit = (options: {
  readonly projectId: string
  readonly fileName: string
  readonly sourceText: string
  readonly start: number
  readonly end: number
  readonly newText: string
  readonly evidenceIds?: ReadonlyArray<string> | undefined
}): TextEdit => ({
  projectId: options.projectId,
  fileName: options.fileName,
  start: options.start,
  end: options.end,
  newText: options.newText,
  expectedTextHash: sha256(options.sourceText.slice(options.start, options.end)),
  evidenceIds: options.evidenceIds ?? [],
})

export class InvalidEdit extends Data.TaggedError("InvalidEdit")<{
  readonly edit: TextEdit
  readonly reason: "range" | "source-mismatch"
}> {}

export class EditConflict extends Data.TaggedError("EditConflict")<{
  readonly left: TextEdit
  readonly right: TextEdit
}> {}

export const compareEdits = (left: TextEdit, right: TextEdit): number =>
  left.projectId.localeCompare(right.projectId) ||
  left.fileName.localeCompare(right.fileName) ||
  left.start - right.start ||
  left.end - right.end ||
  left.newText.localeCompare(right.newText)

export const editsConflict = (left: TextEdit, right: TextEdit): boolean => {
  if (left.projectId !== right.projectId || left.fileName !== right.fileName) return false
  const leftInsert = left.start === left.end
  const rightInsert = right.start === right.end
  if (leftInsert && rightInsert) return left.start === right.start
  if (leftInsert) return left.start >= right.start && left.start <= right.end
  if (rightInsert) return right.start >= left.start && right.start <= left.end
  return left.start < right.end && right.start < left.end
}

export const normalizeEdits = (
  edits: ReadonlyArray<TextEdit>,
): Effect.Effect<ReadonlyArray<TextEdit>, InvalidEdit | EditConflict> =>
  Effect.gen(function* () {
    const sorted = [...edits].sort(compareEdits)
    for (const edit of sorted) {
      if (
        !Number.isInteger(edit.start) ||
        !Number.isInteger(edit.end) ||
        edit.start < 0 ||
        edit.end < edit.start
      ) {
        return yield* new InvalidEdit({ edit, reason: "range" })
      }
    }
    for (let index = 1; index < sorted.length; index++) {
      const left = sorted[index - 1]!
      const right = sorted[index]!
      if (editsConflict(left, right)) return yield* new EditConflict({ left, right })
    }
    return sorted
  })

interface TextReplacement {
  readonly start: number
  readonly end: number
  readonly newText: string
}

/** Apply non-overlapping text replacements from right to left so offsets remain stable. */
export const applyTextReplacements = (
  sourceText: string,
  replacements: ReadonlyArray<TextReplacement>,
): string => {
  let ordered = replacements
  for (let index = 1; index < replacements.length; index++) {
    if (replacements[index - 1]!.start <= replacements[index]!.start) continue
    ordered = [...replacements].sort((left, right) => left.start - right.start)
    break
  }
  let output = sourceText
  for (let index = ordered.length - 1; index >= 0; index--) {
    const replacement = ordered[index]!
    output = `${output.slice(0, replacement.start)}${replacement.newText}${output.slice(replacement.end)}`
  }
  return output
}

export const applyFileEdits = (
  sourceText: string,
  edits: ReadonlyArray<TextEdit>,
): Effect.Effect<string, InvalidEdit | EditConflict> =>
  Effect.gen(function* () {
    const normalized = yield* normalizeEdits(edits)
    for (const edit of normalized) {
      if (edit.end > sourceText.length) return yield* new InvalidEdit({ edit, reason: "range" })
      if (sha256(sourceText.slice(edit.start, edit.end)) !== edit.expectedTextHash) {
        return yield* new InvalidEdit({ edit, reason: "source-mismatch" })
      }
    }
    return applyTextReplacements(sourceText, normalized)
  })
