import { Effect } from "effect"
import { InvalidEdit, type EditConflict, type TextEdit } from "./TextEdit.ts"
import { sha256 } from "./Hash.ts"
import { normalizeEdits } from "./Validate.ts"

export interface TextReplacement {
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
