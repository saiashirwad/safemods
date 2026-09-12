/** Process-local capability that grants application authority. */
import { Brand, Predicate } from "effect"
import type { ValidatedPlan } from "../Plan.ts"
import type { DiagnosticDiff } from "./Diagnostics.ts"
import type { PlanPreview } from "./Preview.ts"

/** Only plans in this set carry application authority; the brand is compile-time only. */
const issuedVerifiedPlans = new WeakSet<object>()

export type VerifiedPlan = Brand.Branded<
  {
    readonly plan: ValidatedPlan
    readonly preview: PlanPreview
    readonly diagnosticDiff: DiagnosticDiff
  },
  "VerifiedPlan"
>

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
  diagnosticDiff: DiagnosticDiff,
): VerifiedPlan => {
  const issued = Object.freeze(
    Brand.nominal<VerifiedPlan>()({
      plan: freezeDeep(plan),
      preview: freezeDeep(preview),
      diagnosticDiff: freezeDeep(diagnosticDiff),
    }),
  )
  issuedVerifiedPlans.add(issued)
  return issued
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Process-local capability guard at the public application boundary.
export const isVerifiedPlan = (value: unknown): value is VerifiedPlan =>
  Predicate.isObject(value) && issuedVerifiedPlans.has(value)
