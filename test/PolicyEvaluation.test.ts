import { describe, expect, it } from "vitest"
import type { DiagnosticDiff, PolicyEvaluationContext } from "../src/Policy.ts"
import {
  evaluateBuiltInPolicies,
  evaluateCustomRules,
} from "../src/Verification/PolicyEvaluation.ts"

const emptyDiagnosticDiff: DiagnosticDiff = {
  introduced: [],
  resolved: [],
  unchanged: [],
}

describe("policy evaluation", () => {
  it("passes when every built-in policy holds", () => {
    const failure = evaluateBuiltInPolicies({
      policies: {
        matchCount: { min: 1, max: 2 },
        maxAffectedFiles: 2,
        diagnostics: "no-new-errors",
        idempotence: "required",
      },
      actualMatches: 1,
      affectedFiles: 1,
      diagnosticDiff: emptyDiagnosticDiff,
      secondPlanChangeCount: 0,
    })

    expect(failure).toBeUndefined()
  })

  it("keeps the established built-in failure order", () => {
    const diagnosticDiff: DiagnosticDiff = {
      ...emptyDiagnosticDiff,
      introduced: [{ code: 1, message: "new error", category: "error" }],
    }
    const failure = evaluateBuiltInPolicies({
      policies: {
        matchCount: { min: 2 },
        maxAffectedFiles: 0,
        diagnostics: "no-new-errors",
        idempotence: "required",
      },
      actualMatches: 1,
      affectedFiles: 1,
      diagnosticDiff,
      secondPlanChangeCount: 1,
    })

    expect(failure).toEqual({ policy: "matches", detail: "Observed 1" })
  })

  it("reports introduced error details from the durable diagnostics policy", () => {
    const failure = evaluateBuiltInPolicies({
      policies: {
        matchCount: {},
        diagnostics: "no-new-errors",
        idempotence: "not-promised",
      },
      affectedFiles: 1,
      diagnosticDiff: {
        ...emptyDiagnosticDiff,
        introduced: [{ code: 2322, message: "Type mismatch", category: "error" }],
      },
    })

    expect(failure).toEqual({
      policy: "diagnostics",
      detail: "Introduced 1 new error diagnostic(s): TS2322: Type mismatch",
      diagnostics: [{ code: 2322, message: "Type mismatch", category: "error" }],
    })
  })

  it("stops custom rules at the first failure", () => {
    const visited: Array<string> = []
    const context: PolicyEvaluationContext = {
      actualMatches: 0,
      affectedFiles: 0,
      diagnosticDiff: emptyDiagnosticDiff,
    }
    const failure = evaluateCustomRules(
      [
        {
          name: "first",
          evaluate: () => {
            visited.push("first")
            return true
          },
        },
        {
          name: "second",
          evaluate: () => {
            visited.push("second")
            return "failed"
          },
        },
        {
          name: "third",
          evaluate: () => {
            visited.push("third")
            return true
          },
        },
      ],
      context,
    )

    expect(visited).toEqual(["first", "second"])
    expect(failure).toEqual({ policy: "diagnostics", detail: "failed", diagnostics: [] })
  })
})
