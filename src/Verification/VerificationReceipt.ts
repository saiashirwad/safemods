/** Durable verification outcome issued alongside every VerifiedPlan. */
import type { PolicyResult } from "./PolicyEvaluation.ts"

export interface VerificationReceipt {
  /** Error diagnostics introduced minus error diagnostics resolved. */
  readonly diagnosticDelta: number
  readonly idempotenceChecked: boolean
  readonly policyResults: ReadonlyArray<PolicyResult>
}
