import { Data } from "effect"
import type * as WorkspacePath from "../WorkspacePath.ts"
import type { DiagnosticRecord } from "./Diagnostics.ts"

export class StalePlanError extends Data.TaggedError("StalePlanError")<{
  readonly fileName: WorkspacePath.Type
}> {}

export class VerificationFailure extends Data.TaggedError("VerificationFailure")<{
  readonly policy: "affected-files" | "diagnostics" | "idempotence"
  readonly detail: string
  readonly diagnostics?: ReadonlyArray<DiagnosticRecord>
}> {}
