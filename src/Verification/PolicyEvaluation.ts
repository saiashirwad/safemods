/** Pure evaluation of durable policies and runtime verification rules. */
import type { PlanPolicies } from "../Plan/index.ts"
import {
  type AllowedError,
  type DiagnosticDiff,
  type DiagnosticRecord,
  type PolicyEvaluationContext,
  type VerificationRule,
  unpermittedIntroducedErrors,
} from "../Policy/index.ts"

export interface PolicyFailure {
  readonly policy: "matches" | "affected-files" | "diagnostics" | "idempotence"
  readonly detail: string
  readonly diagnostics?: ReadonlyArray<DiagnosticRecord> | undefined
}

export interface BuiltInPolicyInput {
  readonly policies: PlanPolicies
  readonly actualMatches?: number | undefined
  readonly affectedFiles: number
  readonly diagnosticDiff: DiagnosticDiff
  readonly secondPlanChangeCount?: number | undefined
  readonly allowedErrors?: ReadonlyArray<AllowedError> | undefined
}

/** Evaluate every durable built-in policy in its established order. */
export const evaluateBuiltInPolicies = (input: BuiltInPolicyInput): PolicyFailure | undefined => {
  const { min, max } = input.policies.matchCount
  const hasMatchBounds = min !== undefined || max !== undefined
  const missingMatchMeasurement = hasMatchBounds && input.actualMatches === undefined
  const matchesPassed =
    !missingMatchMeasurement &&
    (min === undefined || input.actualMatches! >= min) &&
    (max === undefined || input.actualMatches! <= max)

  const affectedFilesPassed =
    input.policies.maxAffectedFiles === undefined ||
    input.affectedFiles <= input.policies.maxAffectedFiles

  const unpermittedErrors = unpermittedIntroducedErrors(
    input.diagnosticDiff,
    input.allowedErrors ?? [],
  )
  const diagnosticsPassed =
    input.policies.diagnostics === "allow-new-errors" || unpermittedErrors.length === 0

  const idempotencePassed =
    input.policies.idempotence !== "required" || input.secondPlanChangeCount === 0

  if (missingMatchMeasurement) {
    return { policy: "matches", detail: "Plan carries no primary-run match measurement" }
  }
  if (!matchesPassed) return { policy: "matches", detail: `Observed ${input.actualMatches}` }
  if (!affectedFilesPassed) {
    return { policy: "affected-files", detail: `Observed ${input.affectedFiles}` }
  }
  if (!diagnosticsPassed) {
    return {
      policy: "diagnostics",
      detail: `Introduced ${unpermittedErrors.length} new error diagnostic(s): ${unpermittedErrors.map((error) => `TS${error.code}: ${error.message}`).join("; ")}`,
      diagnostics: unpermittedErrors,
    }
  }
  if (!idempotencePassed) {
    return { policy: "idempotence", detail: "Second recipe run was not empty" }
  }
  return undefined
}

/** Evaluate custom rules in declaration order and stop at the first failure. */
export const evaluateCustomRules = (
  rules: ReadonlyArray<VerificationRule>,
  context: PolicyEvaluationContext,
): PolicyFailure | undefined => {
  for (const rule of rules) {
    if (rule.evaluate === undefined) continue
    const result = rule.evaluate(context)
    if (result === true) continue
    const detail = result === false ? `Policy rule '${rule.name}' failed` : result
    return { policy: "diagnostics", detail, diagnostics: context.diagnosticDiff.introduced }
  }
  return undefined
}
