import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { textEdit } from "../src/Edit.ts"
import * as FileRef from "../src/FileRef.ts"
import { type FileOperation, type Plan, validate } from "../src/Plan.ts"
import { projectId, projectPath } from "./utils/domain.ts"

const app = projectId("app")
const ref = (fileName: string) => ({ projectId: app, fileName: projectPath(fileName) })

const contents: FileRef.Map<Uint8Array | undefined> = new Map()
for (
  const [fileName, text] of [
    ["src/index.ts", "source"],
    ["src/delete.ts", "delete"],
    ["src/move.ts", "move"],
    ["src/created.ts", undefined],
    ["src/moved.ts", undefined],
  ] as const
) {
  FileRef.set(
    contents,
    ref(fileName),
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
  toFileName: projectPath("src/moved.ts"),
}

const outcome = (plan: Partial<Plan>) =>
  validate({ edits: [], fileOperations: [], unsupported: [], ...plan }, contents).pipe(
    Effect.match({ onFailure: (error) => error.detail, onSuccess: () => "valid" }),
  )

describe("Plan.validate", () => {
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
        const cases: ReadonlyArray<readonly [Partial<Plan>, string]> = [
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
            { fileOperations: [{ ...move, toFileName: projectPath("src/index.ts") }] },
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
