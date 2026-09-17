import { Predicate } from "effect"
import type { ValidatedPlan } from "../Plan.ts"
import type { Workspace } from "../Workspace/index.ts"
import type { DiagnosticDiff } from "./Diagnostics.ts"
import type { PlanPreview } from "./Preview.ts"

declare const VerifiedPlanTypeId: unique symbol

export interface VerifiedPlan {
  readonly [VerifiedPlanTypeId]: true
  readonly preview: PlanPreview
  readonly diagnosticDiff: DiagnosticDiff
}

interface ApplicationState {
  readonly workspace: Workspace["Service"]
  readonly plan: ValidatedPlan
  readonly preview: PlanPreview
}

const issued = new WeakMap<object, ApplicationState>()

const deepFreeze = <A>(value: A): A => {
  if (ArrayBuffer.isView(value)) return value
  if (Array.isArray(value) || Predicate.isObject(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const clonePreview = (preview: PlanPreview): PlanPreview => structuredClone(preview)

export const issue = (
  workspace: Workspace["Service"],
  plan: ValidatedPlan,
  preview: PlanPreview,
  diagnosticDiff: DiagnosticDiff,
): VerifiedPlan => {
  const verified = Object.freeze({
    preview: deepFreeze(clonePreview(preview)),
    diagnosticDiff: deepFreeze(diagnosticDiff),
  }) as VerifiedPlan
  issued.set(verified, { workspace, plan, preview })
  return verified
}

export const applicationState = (verified: VerifiedPlan): ApplicationState | undefined =>
  issued.get(verified)
