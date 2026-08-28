import { Data } from "effect"
import { sha256 } from "./Hash.ts"

/** The canonical durable, guarded, half-open source range replacement. */
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
