import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { finalizePlan } from "../src/Plan/Finalize.ts"
import { parsePlan, serializePlan } from "../src/Plan/Codec.ts"
import type { PlanInput } from "../src/Plan/TransformationPlan.ts"
import { richInput } from "./utils/plan-schema.ts"

describe("plan codec and canonicalization", () => {
  effect("round-trips the schema-version 1 canonical fixture without changing IDs", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      const serialized = serializePlan(plan)
      const parsed = yield* parsePlan(serialized)

      expect(plan.schemaVersion).toBe(1)
      expect(plan.planId).toBe("4c21f75c1188213ff7a7630678ea6b697789db924d4e4ddc0c987f13279cb768")
      expect(plan.snapshotHash).toBe(
        "b94070e67eb09e018c5bf1263bd3941d9f221d5d6d0afecf9fe39c0ea218d7d1",
      )
      expect(serializePlan(parsed)).toBe(serialized)
      expect(parsed).toEqual(plan)
    }),
  )

  effect("hashes Windows-style paths identically to portable paths", () =>
    Effect.gen(function* () {
      const windowsStylePaths: PlanInput = {
        ...richInput,
        sources: richInput.sources.map((source) => ({
          ...source,
          fileName: source.fileName.replaceAll("/", "\\"),
        })),
        edits: richInput.edits.map((edit) => ({
          ...edit,
          fileName: edit.fileName.replaceAll("/", "\\"),
        })),
      }
      const portablePlan = yield* finalizePlan(richInput)
      const windowsStylePlan = yield* finalizePlan(windowsStylePaths)
      expect(windowsStylePlan.planId).toBe(portablePlan.planId)
      expect(windowsStylePlan.snapshotHash).toBe(portablePlan.snapshotHash)
    }),
  )
})
