import { describe, effect, expect } from "@effect/vitest"
import { Effect, Exit, type Schema } from "effect"
import { canonicalJson } from "../src/Evidence.ts"
import { parsePlan, serializePlan, snapshotHashOf, validatePlan } from "../src/Plan/Codec.ts"
import { finalizePlan } from "../src/Plan/Finalize.ts"
import type { PlanInput, TransformationPlan } from "../src/Plan/TransformationPlan.ts"
import {
  exactStructureMutations,
  nonJsonMutations,
  rehashPlan,
  richInput,
  semanticMutations,
} from "./utils/plan-schema.ts"

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- invalid payloads on purpose.
const validateUnknown = (candidate: unknown) =>
  // SAFETY: mutation tables deliberately send untyped payloads across the plan boundary.
  validatePlan(candidate as TransformationPlan)
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- invalid payloads on purpose.
const finalizeUnknown = (candidate: unknown) =>
  // SAFETY: mutation tables deliberately send untyped payloads across the plan boundary.
  finalizePlan(candidate as PlanInput)
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- invalid payloads on purpose.
const encodeUnknown = (candidate: unknown): string =>
  // SAFETY: structural mutations remain JSON values.
  canonicalJson(candidate as Schema.Json)

describe("plan structural and semantic validation", () => {
  effect("rejects structural mutations at the validate and parse boundaries", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      for (const mutation of exactStructureMutations) {
        const mutatedPlan = mutation.mutate(plan)
        const validated = yield* validateUnknown(mutatedPlan).pipe(Effect.result)
        const parsed = yield* parsePlan(encodeUnknown(mutatedPlan)).pipe(Effect.result)

        expect({ name: mutation.name, outcome: validated._tag }).toEqual({
          name: mutation.name,
          outcome: "Failure",
        })
        expect({ name: mutation.name, outcome: parsed._tag }).toEqual({
          name: mutation.name,
          outcome: "Failure",
        })
        if (validated._tag === "Failure") expect(validated.failure.reason).toBe("schema")
        if (parsed._tag === "Failure") expect(parsed.failure.reason).toBe("schema")
      }
    }),
  )

  effect("rejects non-JSON options and evidence at the validate boundary", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      for (const mutation of nonJsonMutations) {
        const validated = yield* validateUnknown(mutation.mutate(plan)).pipe(Effect.result)
        expect({ name: mutation.name, outcome: validated._tag }).toEqual({
          name: mutation.name,
          outcome: "Failure",
        })
        if (validated._tag === "Failure") expect(validated.failure.reason).toBe("schema")
      }
    }),
  )

  effect("rejects semantic input mutations", () =>
    Effect.gen(function* () {
      for (const mutation of semanticMutations) {
        const result = yield* Effect.exit(finalizeUnknown(mutation.mutate(richInput)))
        expect({ name: mutation.name, rejected: Exit.isFailure(result) }).toEqual({
          name: mutation.name,
          rejected: true,
        })
      }
    }),
  )

  effect("rejects non-canonical array ordering even when hashes are recomputed", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      const sources = [...plan.sources].reverse()
      const unorderedPlans = [
        rehashPlan({ ...plan, evidence: [...plan.evidence].reverse() }),
        rehashPlan({ ...plan, fileOperations: [...plan.fileOperations!].reverse() }),
        rehashPlan({
          ...plan,
          sources,
          snapshotHash: snapshotHashOf({ projects: plan.projects, sources }),
        }),
      ]

      for (const unordered of unorderedPlans) {
        const validated = yield* validatePlan(unordered).pipe(Effect.result)
        const parsed = yield* parsePlan(serializePlan(unordered)).pipe(Effect.result)
        expect(validated._tag).toBe("Failure")
        expect(parsed._tag).toBe("Failure")
        if (validated._tag === "Failure") expect(validated.failure.reason).toBe("schema")
        if (parsed._tag === "Failure") expect(parsed.failure.reason).toBe("schema")
      }
    }),
  )
})
