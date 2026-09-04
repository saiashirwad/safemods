import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { DraftEvidenceConflict, finalizeDraftEvidence, mergeEvidence } from "./Finalize.ts"

describe("draft evidence finalization", () => {
  effect("merges records and completes every referenced ID in stable order", () =>
    Effect.gen(function* () {
      const draft = yield* finalizeDraftEvidence(
        {
          edits: [{ evidenceIds: ["declared", "edit"] }],
          fileOperations: [{ evidenceIds: ["operation", "edit"] }],
          evidence: [{ id: "declared", kind: "selection", facts: { selected: true } }],
          matches: 1,
        },
        { facts: { source: "test" } },
      )

      expect(draft.evidence).toEqual([
        { id: "declared", kind: "selection", facts: { selected: true } },
        { id: "edit", kind: "draft-operation", facts: { source: "test" } },
        { id: "operation", kind: "draft-operation", facts: { source: "test" } },
      ])
      expect(draft.matches).toBe(1)
    }),
  )

  effect("deduplicates records with canonically equal facts", () =>
    Effect.gen(function* () {
      const evidence = yield* mergeEvidence([
        { id: "same", kind: "selection", facts: { first: true, second: 2 } },
        { id: "same", kind: "selection", facts: { second: 2, first: true } },
      ])

      expect(evidence).toHaveLength(1)
    }),
  )

  effect("rejects one ID with different evidence", () =>
    Effect.gen(function* () {
      const result = yield* mergeEvidence([
        { id: "same", kind: "selection", facts: { value: 1 } },
        { id: "same", kind: "selection", facts: { value: 2 } },
      ]).pipe(Effect.result)

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure).toBeInstanceOf(DraftEvidenceConflict)
      }
    }),
  )
})
