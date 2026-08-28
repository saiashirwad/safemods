import { Effect } from "effect"
import { canonicalizeContent, planHashOf, snapshotHashOf } from "./Codec.ts"
import type { PlanBuildError, PlanInput, TransformationPlan } from "./TransformationPlan.ts"
import { validateInput } from "./Validate.ts"

export const finalizePlan = (input: PlanInput): Effect.Effect<TransformationPlan, PlanBuildError> =>
  Effect.gen(function* () {
    yield* validateInput(input)
    const content = canonicalizeContent(input)
    const provisional: TransformationPlan = {
      schemaVersion: 1,
      planId: "",
      ...content,
      snapshotHash: snapshotHashOf(content),
    }
    return { ...provisional, planId: planHashOf(provisional) }
  })
