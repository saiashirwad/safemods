/** Pure evaluation of durable plan policies. */
import type { PlanPolicies } from "../Plan.ts"
import type { DiagnosticDiff, DiagnosticRecord } from "../Policy.ts"

export const diagnosticIdentity = (diagnostic: DiagnosticRecord): string =>
  JSON.stringify([
    diagnostic.category,
    diagnostic.code,
    diagnostic.fileName ?? null,
    diagnostic.start ?? null,
    diagnostic.length ?? null,
    diagnostic.message,
  ])

export const computeDiagnosticDiff = (
  baseline: ReadonlyArray<DiagnosticRecord>,
  proposed: ReadonlyArray<DiagnosticRecord>,
): DiagnosticDiff => {
  const baselineMap = Map.groupBy(baseline, diagnosticIdentity)
  const proposedMap = Map.groupBy(proposed, diagnosticIdentity)

  const introduced: Array<DiagnosticRecord> = []
  const unchanged: Array<DiagnosticRecord> = []
  const resolved: Array<DiagnosticRecord> = []

  for (const [diagnosticKey, diagnostics] of proposedMap.entries()) {
    const baselineMatches = baselineMap.get(diagnosticKey)?.length ?? 0
    unchanged.push(...diagnostics.slice(0, baselineMatches))
    introduced.push(...diagnostics.slice(baselineMatches))
  }

  for (const [diagnosticKey, diagnostics] of baselineMap.entries()) {
    const proposedMatches = proposedMap.get(diagnosticKey)?.length ?? 0
    resolved.push(...diagnostics.slice(proposedMatches))
  }

  return { introduced, resolved, unchanged }
}

interface PolicyFailure {
  readonly policy: "matches" | "affected-files" | "diagnostics" | "idempotence"
  readonly detail: string
  readonly diagnostics?: ReadonlyArray<DiagnosticRecord> | undefined
}

interface BuiltInPolicyInput {
  readonly policies: PlanPolicies
  readonly actualMatches?: number | undefined
  readonly affectedFiles: number
  readonly diagnosticDiff: DiagnosticDiff
  readonly secondPlanChangeCount?: number | undefined
}

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

  const introducedErrors = input.diagnosticDiff.introduced.filter(
    (diagnostic) => diagnostic.category === "error",
  )
  const diagnosticsPassed =
    input.policies.diagnostics === "allow-new-errors" || introducedErrors.length === 0

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
      detail: `Introduced ${introducedErrors.length} new error diagnostic(s): ${introducedErrors.map((error) => `TS${error.code}: ${error.message}`).join("; ")}`,
      diagnostics: introducedErrors,
    }
  }
  if (!idempotencePassed) {
    return { policy: "idempotence", detail: "Second recipe run was not empty" }
  }
  return undefined
}
