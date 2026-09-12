import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import {
  finalizePlan,
  parsePlan,
  planHashOf,
  serializePlan,
  snapshotHashOf,
  type TransformationPlan,
  validatePlan,
} from "../src/Plan.ts"
import { richInput, semanticMutations } from "./utils/plan-schema.ts"
import type * as ProjectRelativePath from "../src/ProjectRelativePath.ts"
import type * as Sha256 from "../src/Sha256.ts"

// SAFETY: these tests deliberately build invalid plans to exercise validation.
const uncheckedPath = (value: string) => value as ProjectRelativePath.Type
// SAFETY: these tests deliberately build invalid plans to exercise validation.
const uncheckedHash = (value: string) => value as Sha256.Type

const rejects = (plan: TransformationPlan) =>
  Effect.gen(function* () {
    const validated = yield* validatePlan(plan).pipe(Effect.result)
    const parsed = yield* parsePlan(serializePlan(plan)).pipe(Effect.result)
    return validated._tag === "Failure" && parsed._tag === "Failure"
  })

describe("plan validation", () => {
  effect("rejects semantic input mutations", () =>
    Effect.gen(function* () {
      for (const mutation of semanticMutations) {
        const result = yield* finalizePlan(mutation.mutate(richInput)).pipe(Effect.result)
        expect({ name: mutation.name, outcome: result._tag }).toEqual({
          name: mutation.name,
          outcome: "Failure",
        })
      }
    }),
  )

  effect("rejects unknown and missing fields", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      const { recipe: _, ...missingRecipe } = plan
      // SAFETY: deliberately malformed payloads crossing the parse boundary.
      expect(yield* rejects({ ...plan, unexpected: true } as TransformationPlan)).toBe(true)
      // SAFETY: deliberately malformed payloads crossing the parse boundary.
      expect(yield* rejects(missingRecipe as TransformationPlan)).toBe(true)
    }),
  )

  effect("rejects tampered hashes and non-canonical ordering", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      const rehash = (candidate: TransformationPlan) => ({
        ...candidate,
        planId: planHashOf(candidate),
      })
      const sources = [...plan.sources].reverse()
      const tampered: ReadonlyArray<TransformationPlan> = [
        { ...plan, planId: uncheckedHash("0".repeat(64)) },
        { ...plan, snapshotHash: uncheckedHash("0".repeat(64)) },
        rehash({ ...plan, evidence: [...plan.evidence].reverse() }),
        rehash({ ...plan, fileOperations: [...plan.fileOperations].reverse() }),
        rehash({
          ...plan,
          sources,
          snapshotHash: snapshotHashOf({ projects: plan.projects, sources }),
        }),
        rehash({
          ...plan,
          edits: [{ ...plan.edits[0]!, fileName: uncheckedPath("./src/index.ts") }],
        }),
      ]
      for (const candidate of tampered) expect(yield* rejects(candidate)).toBe(true)
    }),
  )
})
