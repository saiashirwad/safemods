import * as Position from "./Position.ts"
import type * as WorkspacePath from "./WorkspacePath.ts"

export interface Location {
  readonly fileName: WorkspacePath.Type
  readonly start: number
  readonly end: number
}

export interface Issue extends Location {
  readonly message: string
}

export interface Located extends Issue, Position.Position {}

export const locate = <F extends Issue>(finding: F, text: string): F & Position.Position => ({
  ...finding,
  ...Position.at(text, finding.start),
})
