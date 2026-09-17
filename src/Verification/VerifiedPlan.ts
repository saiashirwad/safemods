import { Predicate } from "effect"
import type { ValidatedPlan } from "../Plan.ts"
import type { Workspace } from "../Workspace/index.ts"
import type { DiagnosticDiff } from "./Diagnostics.ts"
import type { PlanPreview } from "./Preview.ts"

declare const VerifiedPlanTypeId: unique symbol

export interface VerifiedPlan {
  readonly [VerifiedPlanTypeId]: true
  readonly workspace: Workspace["Service"]
  readonly plan: ValidatedPlan
  readonly preview: PlanPreview
  readonly diagnosticDiff: DiagnosticDiff
}

const issued = new WeakSet<object>()

const deepFreeze = <A>(value: A): A => {
  if (ArrayBuffer.isView(value)) return value
  if (Array.isArray(value) || Predicate.isObject(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

export const issue = (
  workspace: Workspace["Service"],
  plan: ValidatedPlan,
  preview: PlanPreview,
  diagnosticDiff: DiagnosticDiff,
): VerifiedPlan => {
  const verified = Object.freeze({
    workspace,
    plan: deepFreeze(plan),
    preview: deepFreeze(preview),
    diagnosticDiff: deepFreeze(diagnosticDiff),
  }) as VerifiedPlan
  issued.add(verified)
  return verified
}

export const isIssued = (verified: VerifiedPlan): boolean => issued.has(verified)
