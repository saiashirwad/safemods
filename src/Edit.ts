import { Data, Effect, Order, Schema } from "effect"
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
  readonly evidenceIds?: ReadonlyArray<string>
}): TextEdit => ({
  projectId: options.projectId,
  fileName: options.fileName,
  start: options.start,
  end: options.end,
  expectedTextHash: Sha256.digest(options.sourceText.slice(options.start, options.end)),
  newText: options.newText,
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
  Order.String(left.projectId, right.projectId) ||
  Order.String(left.fileName, right.fileName) ||
  left.start - right.start ||
  left.end - right.end ||
  Order.String(left.newText, right.newText)

const touches = (insert: TextEdit, other: TextEdit): boolean =>
  other.start === other.end
    ? insert.start === other.start
    : insert.start >= other.start && insert.start < other.end

const editsConflict = (left: TextEdit, right: TextEdit): boolean => {
  if (left.projectId !== right.projectId || left.fileName !== right.fileName) return false
  if (left.start === left.end) return touches(left, right)
  if (right.start === right.end) return touches(right, left)
  return left.start < right.end && right.start < left.end
}

export const firstConflict = (
  sorted: ReadonlyArray<TextEdit>,
): readonly [TextEdit, TextEdit] | undefined => {
  for (let index = 1; index < sorted.length; index++) {
    const left = sorted[index - 1]!
    const right = sorted[index]!
    if (editsConflict(left, right)) return [left, right]
  }
  return undefined
}

export const applyFileEdits = (
  sourceText: string,
  edits: ReadonlyArray<TextEdit>,
): Effect.Effect<string, InvalidEdit | EditConflict> =>
  Effect.gen(function* () {
    const sorted = [...edits].sort(compareEdits)
    const conflict = firstConflict(sorted)
    if (conflict !== undefined) {
      return yield* new EditConflict({ left: conflict[0], right: conflict[1] })
    }
    let output = sourceText
    for (const edit of sorted.reverse()) {
      if (edit.start < 0 || edit.start > edit.end || edit.end > sourceText.length) {
        return yield* new InvalidEdit({ edit, reason: "range" })
      }
      if (Sha256.digest(sourceText.slice(edit.start, edit.end)) !== edit.expectedTextHash) {
        return yield* new InvalidEdit({ edit, reason: "source-mismatch" })
      }
      output = `${output.slice(0, edit.start)}${edit.newText}${output.slice(edit.end)}`
    }
    return output
  })
