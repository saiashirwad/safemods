import { Data } from "effect"
import type * as ProjectId from "../ProjectId.ts"
import type * as ProjectRelativePath from "../ProjectRelativePath.ts"
import type { DiagnosticRecord } from "./Diagnostics.ts"

export class StalePlanError extends Data.TaggedError("StalePlanError")<{
  readonly projectId: ProjectId.Type
  readonly fileName: ProjectRelativePath.Type
}> {}

export class VerificationFailure extends Data.TaggedError("VerificationFailure")<{
  readonly policy: "affected-files" | "diagnostics" | "idempotence"
  readonly detail: string
  readonly diagnostics?: ReadonlyArray<DiagnosticRecord>
}> {}
