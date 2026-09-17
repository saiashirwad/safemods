import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { finalizePlan, parsePlan, planIdOf, serializePlan, type PlanInput } from "../src/Plan.ts"
import { richInput } from "./utils/plan-schema.ts"

describe("plan codec and canonicalization", () => {
  effect("round-trips through canonical JSON", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      const serialized = serializePlan(plan)
      const parsed = yield* parsePlan(serialized)
      expect(parsed).toEqual(plan)
      expect(serializePlan(parsed)).toBe(serialized)
    }),
  )

  effect("produces the same plan regardless of input order and path style", () =>
    Effect.gen(function* () {
      const shuffled: PlanInput = {
        ...richInput,
        sources: [...richInput.sources].reverse().map((source) => ({
          ...source,
          fileName: source.fileName.replaceAll("/", "\\"),
        })),
        edits: richInput.edits.map((edit) => ({ ...edit, fileName: `./${edit.fileName}` })),
        fileOperations: [...richInput.fileOperations].reverse(),
      }
      expect(yield* finalizePlan(shuffled)).toEqual(yield* finalizePlan(richInput))
    }),
  )

  effect("decodes path transformations through the plan JSON codec", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      const nonCanonicalPath = serializePlan(plan).replace("src/index.ts", ".\\\\src\\\\index.ts")
      const result = yield* parsePlan(nonCanonicalPath).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure.detail).toBe("Plan text is not canonical JSON")
      }
    }),
  )

  effect("rejects schema-invalid JSON without accepting a typed cast", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      const malformed = serializePlan(plan).replace('"schemaVersion":1', '"schemaVersion":"1"')
      const result = yield* parsePlan(malformed).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") expect(result.failure.detail).toBe("Plan is not valid JSON")
    }),
  )

  effect("hashes canonical schema-encoded unsigned content", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan({
        ...richInput,
        sources: richInput.sources.map((source) => ({
          ...source,
          fileName: source.fileName.replaceAll("/", "\\"),
        })),
      })
      const { planId: _, ...unsigned } = plan
      expect(plan.planId).toBe(planIdOf(unsigned))
      expect(plan.planId).toBe((yield* finalizePlan(richInput)).planId)
    }),
  )
})
