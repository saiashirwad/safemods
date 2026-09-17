import { Data } from "effect"
import type * as ProjectId from "../ProjectId.ts"
import type * as ProjectRelativePath from "../ProjectRelativePath.ts"
import type { DiagnosticRecord } from "./Diagnostics.ts"

export class StalePlanError extends Data.TaggedError("StalePlanError")<{
  readonly planId: string
  readonly projectId: ProjectId.Type
  readonly fileName: ProjectRelativePath.Type
}> {}

export class ProjectIdentityMismatch extends Data.TaggedError("ProjectIdentityMismatch")<{
  readonly planId: string
}> {}

export class RecipeMismatch extends Data.TaggedError("RecipeMismatch")<{
  readonly planId: string
  readonly field: "name" | "version" | "input" | "policies"
}> {}

export class VerificationFailure extends Data.TaggedError("VerificationFailure")<{
  readonly planId: string
  readonly policy: "edits" | "affected-files" | "diagnostics" | "idempotence"
  readonly detail: string
  readonly diagnostics?: ReadonlyArray<DiagnosticRecord>
}> {}
