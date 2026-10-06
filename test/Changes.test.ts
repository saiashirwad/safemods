import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { textEdit } from "../src/Edit.ts"
import { distinct, validate } from "../src/Migration/Changes.ts"
import type { FileOperation, Proposal } from "../src/Proposal.ts"
import type * as WorkspacePath from "../src/WorkspacePath.ts"
import { workspacePath } from "./utils/domain.ts"

const ref = (fileName: string) => ({ fileName: workspacePath(fileName) })

const contents = new Map<WorkspacePath.Type, Uint8Array | undefined>()
for (
  const [fileName, text] of [
    ["src/index.ts", "source"],
    ["src/delete.ts", "delete"],
    ["src/move.ts", "move"],
    ["src/created.ts", undefined],
    ["src/moved.ts", undefined],
  ] as const
) {
  contents.set(
    workspacePath(fileName),
    text === undefined ? undefined : new TextEncoder().encode(text),
  )
}

const edit = (fileName: string, start: number, end: number) =>
  textEdit({ ...ref(fileName), sourceText: "source", start, end, newText: "x" })

const create: FileOperation = { kind: "create", ...ref("src/created.ts"), content: "" }
const remove: FileOperation = { kind: "delete", ...ref("src/delete.ts") }
const move: FileOperation = {
  kind: "move",
  ...ref("src/move.ts"),
  toFileName: workspacePath("src/moved.ts"),
}

const outcome = (plan: Partial<Proposal>) =>
  validate({ edits: [], fileOperations: [], unsupported: [], ...plan }, contents).pipe(
    Effect.match({ onFailure: (error) => error.detail, onSuccess: () => "valid" }),
  )

describe("proposal validation", () => {
  effect(
    "deduplicates equal proposals regardless of property insertion order",
    () =>
      Effect.gen(function* () {
        const first = edit("src/index.ts", 0, 1)
        const unsupported = { ...ref("src/index.ts"), start: 0, end: 1, message: "manual" }
        const plan = distinct({
          edits: [
            first,
            {
              newText: first.newText,
              expectedTextHash: first.expectedTextHash,
              end: first.end,
              start: first.start,
              fileName: first.fileName,
            },
          ],
          fileOperations: [create, { content: "", fileName: create.fileName, kind: "create" }],
          unsupported: [
            unsupported,
            { message: "manual", end: 1, start: 0, fileName: unsupported.fileName },
          ],
        })
        expect(plan).toEqual({
          edits: [first],
          fileOperations: [create],
          unsupported: [unsupported],
        })
        expect(yield* outcome(plan)).toBe("valid")
      }),
  )

  effect(
    "accepts disjoint edits with a create, a delete, and a move",
    () =>
      Effect.gen(function* () {
        expect(
          yield* outcome({
            edits: [
              edit("src/index.ts", 0, 1),
              edit("src/index.ts", 2, 3),
              edit("src/move.ts", 0, 1),
            ],
            fileOperations: [create, remove, move],
          }),
        ).toBe("valid")
      }),
  )

  effect(
    "rejects plans whose changes contradict each other or the captured files",
    () =>
      Effect.gen(function* () {
        const cases: ReadonlyArray<readonly [Partial<Proposal>, string]> = [
          [
            { edits: [edit("src/index.ts", 0, 2), edit("src/index.ts", 1, 3)] },
            "Overlapping edits",
          ],
          [{ edits: [edit("src/other.ts", 0, 1)] }, "Missing source src/other.ts"],
          [
            { edits: [edit("src/delete.ts", 0, 1)], fileOperations: [remove] },
            "Edit conflicts with delete of src/delete.ts",
          ],
          [
            { fileOperations: [{ ...create, ...ref("src/index.ts") }] },
            "Create needs an absent path: src/index.ts",
          ],
          [
            { fileOperations: [{ ...move, toFileName: workspacePath("src/index.ts") }] },
            "Move needs an absent target: src/index.ts",
          ],
          [
            { fileOperations: [move, { ...create, ...ref("src/moved.ts") }] },
            "Conflicting file operations on src/moved.ts",
          ],
        ]
        for (const [plan, expected] of cases) expect(yield* outcome(plan)).toBe(expected)
      }),
  )
})
