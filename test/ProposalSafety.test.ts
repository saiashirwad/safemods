import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { textEdit } from "../src/Edit.ts"
import { validate } from "../src/Migration/Changes.ts"
import { previewOf } from "../src/Migration/Preview.ts"
import * as Proposal from "../src/Proposal.ts"
import { workspacePath } from "./utils/domain.ts"

const fileName = workspacePath("src/value.ts")
const sourceText = "export const value = 1\n"
const contents = new Map([[fileName, new TextEncoder().encode(sourceText)]])

describe("proposal safety", () => {
  effect("rejects non-finite, fractional, and unsafe edit ranges", () =>
    Effect.gen(function* () {
      for (const start of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        const proposal = {
          ...Proposal.empty,
          edits: [textEdit({ fileName, sourceText, start, end: start, newText: "x" })],
        }
        expect(yield* Effect.flip(validate(proposal, contents))).toMatchObject({
          _tag: "InvalidProposal",
        })
      }
    }))

  effect("omits identity edits from the materialized changes", () =>
    Effect.gen(function* () {
      const preview = yield* previewOf({
        ...Proposal.empty,
        edits: [
          textEdit({ fileName, sourceText, start: 0, end: sourceText.length, newText: sourceText }),
        ],
      }, contents)
      expect(preview.files).toEqual([])
      expect(preview.sources[0]?.before).toMatchObject({ exists: true, text: sourceText })
    }))

  effect(
    "returns a typed failure for invalid UTF-8 even in a delete",
    () =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          previewOf(
            { ...Proposal.empty, fileOperations: [{ kind: "delete", fileName }] },
            new Map([[fileName, new Uint8Array([0xff])]]),
          ),
        )
        expect(failure).toMatchObject({ _tag: "InvalidProposal" })
        expect(failure.detail).toContain("Invalid UTF-8")
      }),
  )
})
