import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { finalizePlan, parsePlan, serializePlan } from "../src/Plan.ts"
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
      const shuffled = {
        ...richInput,
        sources: [...richInput.sources].reverse().map((source) => ({
          ...source,
          fileName: source.fileName.replaceAll("/", "\\"),
        })),
        edits: richInput.edits.map((edit) => ({ ...edit, fileName: `./${edit.fileName}` })),
        fileOperations: [...richInput.fileOperations].reverse(),
        evidence: [...richInput.evidence].reverse(),
      }
      expect(yield* finalizePlan(shuffled)).toEqual(yield* finalizePlan(richInput))
    }),
  )
})
