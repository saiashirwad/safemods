/** Hash-guarded text edits: construction, validation, and application. */
import { Data, Effect, Schema } from "effect"
import * as ProjectId from "./ProjectId.ts"
import * as ProjectRelativePath from "./ProjectRelativePath.ts"
import * as Sha256 from "./Sha256.ts"

export const NonNegativeInt = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const TextEdit = Schema.Struct({
  projectId: ProjectId.schema,
  fileName: ProjectRelativePath.schema,
  start: NonNegativeInt,
  end: NonNegativeInt,
  expectedTextHash: Sha256.schema,
  newText: Schema.String,
  evidenceIds: Schema.Array(Schema.String),
}).check(
  Schema.makeFilter((edit) => edit.start <= edit.end, { expected: "edit.start <= edit.end" }),
)
export type TextEdit = typeof TextEdit.Type

export const textEdit = (options: {
  readonly projectId: ProjectId.Type
  readonly fileName: ProjectRelativePath.Type
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
  expectedTextHash: Sha256.digest(options.sourceText.slice(options.start, options.end)),
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

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

export const compareEdits = (left: TextEdit, right: TextEdit): number =>
  compareStrings(left.projectId, right.projectId) ||
  compareStrings(left.fileName, right.fileName) ||
  left.start - right.start ||
  left.end - right.end ||
  compareStrings(left.newText, right.newText)

export const editsConflict = (left: TextEdit, right: TextEdit): boolean => {
  if (left.projectId !== right.projectId || left.fileName !== right.fileName) return false
  const leftInsert = left.start === left.end
  const rightInsert = right.start === right.end
  if (leftInsert && rightInsert) return left.start === right.start
  if (leftInsert) return left.start >= right.start && left.start < right.end
  if (rightInsert) return right.start >= left.start && right.start < left.end
  return left.start < right.end && right.start < left.end
}

export const applyFileEdits = (
  sourceText: string,
  edits: ReadonlyArray<TextEdit>,
): Effect.Effect<string, InvalidEdit | EditConflict> =>
  Effect.gen(function* () {
    const sorted = [...edits].sort(compareEdits)
    for (const edit of sorted) {
      if (
        !Number.isInteger(edit.start) ||
        !Number.isInteger(edit.end) ||
        edit.start < 0 ||
        edit.end < edit.start ||
        edit.end > sourceText.length
      ) {
        return yield* new InvalidEdit({ edit, reason: "range" })
      }
    }
    for (let index = 1; index < sorted.length; index++) {
      const left = sorted[index - 1]!
      const right = sorted[index]!
      if (editsConflict(left, right)) return yield* new EditConflict({ left, right })
    }
    for (const edit of sorted) {
      if (Sha256.digest(sourceText.slice(edit.start, edit.end)) !== edit.expectedTextHash) {
        return yield* new InvalidEdit({ edit, reason: "source-mismatch" })
      }
    }
    let output = sourceText
    for (let index = sorted.length - 1; index >= 0; index--) {
      const edit = sorted[index]!
      output = `${output.slice(0, edit.start)}${edit.newText}${output.slice(edit.end)}`
    }
    return output
  })
