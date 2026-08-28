/** Process-local capability that grants application authority. */
import { Predicate } from "effect"
import type { ValidatedPlan } from "../Plan/index.ts"
import type { DiagnosticDiff } from "../Policy/index.ts"
import type { PlanPreview } from "./Preview.ts"
import type { VerificationReceipt } from "./VerificationReceipt.ts"

// Process-local token. Symbol.for would be forgeable across the isolate.
const VerifiedPlanTypeId: unique symbol = Symbol("@safemods/internal/VerifiedPlan")
const issuedVerifiedPlans = new WeakSet<object>()

export interface VerifiedPlan {
  readonly [VerifiedPlanTypeId]: typeof VerifiedPlanTypeId
  readonly plan: ValidatedPlan
  readonly preview: PlanPreview
  readonly receipt: VerificationReceipt
  readonly diagnosticDiff: DiagnosticDiff
}

const freezeDeep = <A>(value: A): A => {
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item)
    return Object.freeze(value)
  }
  if (value !== null && Predicate.isObject(value)) {
    for (const item of Object.values(value)) freezeDeep(item)
    return Object.freeze(value)
  }
  return value
}
export const issueVerifiedPlan = (
  plan: ValidatedPlan,
  preview: PlanPreview,
  receipt: VerificationReceipt,
  diagnosticDiff: DiagnosticDiff,
): VerifiedPlan => {
  const verified: VerifiedPlan = {
    [VerifiedPlanTypeId]: VerifiedPlanTypeId,
    plan: freezeDeep(plan),
    preview: freezeDeep(preview),
    receipt: freezeDeep(receipt),
    diagnosticDiff: freezeDeep(diagnosticDiff),
  }
  const issued = Object.freeze(verified)
  issuedVerifiedPlans.add(issued)
  return issued
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Process-local capability guard at the public application boundary.
export const isVerifiedPlan = (value: unknown): value is VerifiedPlan =>
  Predicate.isObject(value) && issuedVerifiedPlans.has(value)
