import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { finalizeDraftEvidence } from "../src/Evidence.ts"

describe("Evidence", () => {
  effect("fails when an edit references an evidence id with no record", () =>
    Effect.gen(function* () {
      const error = yield* finalizeDraftEvidence({
        edits: [{ evidenceIds: ["absent"] }],
        evidence: [],
      }).pipe(Effect.flip)
      expect(error._tag).toBe("MissingDraftEvidence")
      expect(error.id).toBe("absent")
    }),
  )
})
