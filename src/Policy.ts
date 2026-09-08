import type { Types } from "effect"
import type { PlanPolicies } from "./Plan.ts"

export interface DiagnosticRecord {
  readonly code: number | string
  readonly message: string
  readonly category: "error" | "warning" | "message" | "suggestion"
  readonly fileName?: string | undefined
  readonly start?: number | undefined
  readonly length?: number | undefined
}

export interface DiagnosticDiff {
  readonly introduced: ReadonlyArray<DiagnosticRecord>
  readonly resolved: ReadonlyArray<DiagnosticRecord>
  readonly unchanged: ReadonlyArray<DiagnosticRecord>
}

export interface Policy {
  readonly matchCount?: PlanPolicies["matchCount"] | undefined
  readonly maxAffectedFiles?: number | undefined
  readonly diagnostics?: PlanPolicies["diagnostics"] | undefined
  readonly idempotence?: PlanPolicies["idempotence"] | undefined
}

export const matches = (bounds: { readonly min?: number; readonly max?: number }): Policy => ({
  matchCount: bounds,
})

export const idempotent = (): Policy => ({ idempotence: "required" })

export const all = (policies: ReadonlyArray<Policy>): PlanPolicies => {
  const matchCount: Types.Mutable<PlanPolicies["matchCount"]> = {}
  let maxAffectedFiles: number | undefined
  let diagnostics: PlanPolicies["diagnostics"] = "no-new-errors"
  let idempotence: PlanPolicies["idempotence"] = "not-promised"

  for (const policy of policies) {
    if (policy.matchCount?.min !== undefined) matchCount.min = policy.matchCount.min
    if (policy.matchCount?.max !== undefined) matchCount.max = policy.matchCount.max
    if (policy.maxAffectedFiles !== undefined) maxAffectedFiles = policy.maxAffectedFiles
    if (policy.diagnostics !== undefined) diagnostics = policy.diagnostics
    if (policy.idempotence !== undefined) idempotence = policy.idempotence
  }

  const policy: PlanPolicies = { matchCount, diagnostics, idempotence }
  return maxAffectedFiles === undefined ? policy : { ...policy, maxAffectedFiles }
}
