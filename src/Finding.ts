import * as Position from "./Position.ts"
import type * as WorkspacePath from "./WorkspacePath.ts"

export interface Finding {
  readonly fileName: WorkspacePath.Type
  readonly start: number
  readonly end: number
  readonly message: string
}

export interface Located extends Finding, Position.Position {}

export const locate = <F extends Finding>(finding: F, text: string): F & Position.Position => ({
  ...finding,
  ...Position.at(text, finding.start),
})
