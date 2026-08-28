import { createHash } from "node:crypto"
import type { TextEdit } from "./TextEdit.ts"

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

export const hashDirectoryListing = (names: ReadonlyArray<string>): string =>
  sha256(JSON.stringify([...names].sort()))

export const makeTextEdit = (options: {
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
