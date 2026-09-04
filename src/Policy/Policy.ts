import type { PlanPolicies } from "../Plan/index.ts"

export interface DiagnosticRecord {
  readonly code: number | string
  readonly message: string
  readonly category: "error" | "warning" | "message" | "suggestion"
  readonly fileName?: string | undefined
  readonly start?: number | undefined
  readonly length?: number | undefined
}

export const diagnosticIdentity = (diagnostic: DiagnosticRecord): string =>
  JSON.stringify([
    diagnostic.category,
    diagnostic.code,
    diagnostic.fileName ?? null,
    diagnostic.start ?? null,
    diagnostic.length ?? null,
    diagnostic.message,
  ])

export interface DiagnosticDiff {
  readonly introduced: ReadonlyArray<DiagnosticRecord>
  readonly resolved: ReadonlyArray<DiagnosticRecord>
  readonly unchanged: ReadonlyArray<DiagnosticRecord>
}

export interface AllowedError {
  readonly code: number | string
  readonly max?: number | undefined
}

export interface PolicyEvaluationContext {
  readonly actualMatches: number
  readonly affectedFiles: number
  readonly diagnosticDiff: DiagnosticDiff
  readonly allowedErrors?: ReadonlyArray<AllowedError> | undefined
}

export interface VerificationRule {
  readonly name: string
  readonly evaluate?: ((context: PolicyEvaluationContext) => boolean | string) | undefined
  readonly allowedError?: AllowedError | undefined
}

export interface Policy {
  readonly matchCount?:
    | { readonly min?: number | undefined; readonly max?: number | undefined }
    | undefined
  readonly maxAffectedFiles?: number | undefined
  readonly diagnostics?: PlanPolicies["diagnostics"] | undefined
  readonly idempotence?: PlanPolicies["idempotence"] | undefined
  readonly rules?: ReadonlyArray<VerificationRule> | undefined
}

export interface CompiledPolicy {
  readonly policy: PlanPolicies
  readonly rules: ReadonlyArray<VerificationRule>
}

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

const diagnosticCodeKey = (code: number | string): string => String(code).replace(/^TS/, "")

export const allowedErrorsFromRules = (
  rules: ReadonlyArray<VerificationRule>,
): ReadonlyArray<AllowedError> =>
  rules.flatMap((rule) => (rule.allowedError === undefined ? [] : [rule.allowedError]))

export const unpermittedIntroducedErrors = (
  diff: DiagnosticDiff,
  allowed: ReadonlyArray<AllowedError> = [],
): ReadonlyArray<DiagnosticRecord> => {
  const remaining = new Map<string, number>()
  for (const entry of allowed) {
    remaining.set(diagnosticCodeKey(entry.code), entry.max ?? Infinity)
  }
  const unpermitted: Array<DiagnosticRecord> = []
  for (const diagnostic of diff.introduced) {
    if (diagnostic.category !== "error") continue
    const key = diagnosticCodeKey(diagnostic.code)
    const left = remaining.get(key)
    if (left === undefined || left <= 0) {
      unpermitted.push(diagnostic)
      continue
    }
    remaining.set(key, left - 1)
  }
  return unpermitted
}

export const matches = (bounds: { readonly min?: number; readonly max?: number }): Policy => ({
  matchCount: bounds,
})

export const exactly = (count: number): Policy => ({ matchCount: { min: count, max: count } })

export const atMostFiles = (count: number): Policy => ({ maxAffectedFiles: count })

export const noNewErrors = (): Policy => ({
  diagnostics: "no-new-errors",
})

export const fixesError = (code: number | string): Policy => ({
  rules: [
    {
      name: `fixes-error:TS${code}`,
      evaluate: (ctx) => {
        const targetStr = diagnosticCodeKey(code)
        const resolved = ctx.diagnosticDiff.resolved.some(
          (d) => diagnosticCodeKey(d.code) === targetStr,
        )
        return resolved
          ? true
          : `Expected transformation to resolve diagnostic TS${code}, but it was not resolved.`
      },
    },
  ],
})

export const allowErrors = (options: {
  readonly code: number | string
  readonly max?: number
}): Policy => ({
  rules: [
    {
      name: `allow-errors:TS${options.code}`,
      allowedError: { code: options.code, max: options.max },
    },
  ],
})

export const diagnosticDiff = (
  name: string,
  predicate: (diff: DiagnosticDiff) => boolean | string,
): Policy => ({
  rules: [
    {
      name,
      evaluate: (ctx) => predicate(ctx.diagnosticDiff),
    },
  ],
})

export const idempotent = (): Policy => ({ idempotence: "required" })

interface MatchCountBounds {
  min?: number
  max?: number
}

export const all = (policies: ReadonlyArray<Policy>): CompiledPolicy => {
  const matchCount: MatchCountBounds = {}
  let maxAffectedFiles: number | undefined
  let diagnostics: PlanPolicies["diagnostics"] = "no-new-errors"
  let idempotence: PlanPolicies["idempotence"] = "not-promised"
  const rules: Array<VerificationRule> = []

  for (const policy of policies) {
    if (policy.matchCount?.min !== undefined) matchCount.min = policy.matchCount.min
    if (policy.matchCount?.max !== undefined) matchCount.max = policy.matchCount.max
    if (policy.maxAffectedFiles !== undefined) maxAffectedFiles = policy.maxAffectedFiles
    if (policy.diagnostics !== undefined) diagnostics = policy.diagnostics
    if (policy.idempotence !== undefined) idempotence = policy.idempotence
    if (policy.rules !== undefined) rules.push(...policy.rules)
  }

  const policy: PlanPolicies = {
    matchCount,
    diagnostics,
    idempotence,
  }
  if (maxAffectedFiles !== undefined) {
    return { policy: { ...policy, maxAffectedFiles }, rules }
  }
  return { policy, rules }
}
