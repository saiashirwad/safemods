import { Data } from "effect"
import type { DiagnosticRecord } from "./Diagnostics.ts"

export class StaleMigrationError extends Data.TaggedError("StaleMigrationError")<{
  readonly path: string
}> {
  override readonly message = `Workspace input changed: ${this.path}`
}

export class VerificationFailure extends Data.TaggedError("VerificationFailure")<{
  readonly policy: "affected-files" | "diagnostics" | "idempotence"
  readonly detail: string
  readonly diagnostics?: ReadonlyArray<DiagnosticRecord>
}> {}
