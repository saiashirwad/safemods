/** Normalize Plan input and assign its content-addressed identifiers. */
import { Effect } from "effect"
import { editsConflict } from "../Edit/index.ts"
import { canonicalizeContent, planHashOf, snapshotHashOf } from "./Codec.ts"
import { PlanBuildError, type PlanInput, type TransformationPlan } from "./TransformationPlan.ts"
import { validateInput } from "./Validate.ts"

export const finalizePlan = (input: PlanInput): Effect.Effect<TransformationPlan, PlanBuildError> =>
  Effect.gen(function* () {
    yield* validateInput(input)
    const content = canonicalizeContent(input)

    for (let index = 0; index < content.edits.length; index++) {
      const edit = content.edits[index]!
      const previous = content.edits[index - 1]
      if (previous !== undefined && editsConflict(previous, edit)) {
        return yield* new PlanBuildError({ reason: "edit-conflict", detail: edit.fileName })
      }
    }

    const provisional: TransformationPlan = {
      schemaVersion: 1,
      planId: "",
      ...content,
      snapshotHash: snapshotHashOf(content),
    }
    return { ...provisional, planId: planHashOf(provisional) }
  })
