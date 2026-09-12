import { describe, effect, expect } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { applyFileEdits, textEdit, type TextEdit } from "../src/Edit.ts"
import * as Sha256 from "../src/Sha256.ts"
import { projectId, projectPath } from "./utils/domain.ts"

const edit = (start: number, end: number, newText: string): TextEdit => ({
  projectId: projectId("app"),
  fileName: projectPath("src/index.ts"),
  start,
  end,
  newText,
  expectedTextHash: Sha256.digest("abcdef".slice(start, end)),
  evidenceIds: [],
})

describe("Edit", () => {
  effect("applies edits in offset order regardless of input order", () =>
    Effect.gen(function* () {
      expect(yield* applyFileEdits("abcdef", [edit(4, 5, "E"), edit(1, 2, "B")])).toBe("aBcdEf")
    }),
  )

  effect("rejects insertions at the same position and overlapping replacements", () =>
    Effect.gen(function* () {
      const insertion = yield* Effect.exit(
        applyFileEdits("abcdef", [edit(2, 2, "x"), edit(2, 2, "y")]),
      )
      const overlap = yield* Effect.exit(
        applyFileEdits("abcdef", [edit(1, 4, "x"), edit(3, 5, "y")]),
      )
      expect(Exit.isFailure(insertion)).toBe(true)
      expect(Exit.isFailure(overlap)).toBe(true)
    }),
  )

  effect("guards expected source text", () =>
    Effect.gen(function* () {
      const guarded = textEdit({
        projectId: projectId("app"),
        fileName: projectPath("src/index.ts"),
        sourceText: "abcdef",
        start: 1,
        end: 3,
        newText: "BC",
      })
      expect(yield* applyFileEdits("abcdef", [guarded])).toBe("aBCdef")
      expect(Exit.isFailure(yield* Effect.exit(applyFileEdits("axcdef", [guarded])))).toBe(true)
    }),
  )
})
