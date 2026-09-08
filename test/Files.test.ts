import { hash } from "node:crypto"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import type { PlannedFileOperation } from "../src/Plan.ts"
import { withProject } from "./utils/project-fixture.ts"
import * as Draft from "../src/Draft/index.ts"

/** Narrow a file operation to its variant, failing the test on any other kind. */
const expectKind = <K extends PlannedFileOperation["kind"]>(
  operation: PlannedFileOperation,
  kind: K,
): Extract<PlannedFileOperation, { readonly kind: K }> => {
  expect(operation.kind).toBe(kind)
  // SAFETY: the preceding assertion pins operation.kind to K, so the
  // discriminated union narrows to exactly this variant at runtime.
  return operation as Extract<PlannedFileOperation, { readonly kind: K }>
}

describe("Draft.files", () => {
  effect(
    "create proposes a create operation with complete evidence",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const draft = yield* Draft.files.create(project, "src/new.ts", "export const n = 1\n")
          expect(draft.edits).toEqual([])
          expect(draft.matches).toBe(1)
          expect(draft.fileOperations).toHaveLength(1)
          const operation = expectKind(draft.fileOperations![0]!, "create")
          expect(operation.path).toBe("src/new.ts")
          expect(operation.content).toBe("export const n = 1\n")

          expect(draft.evidence).toHaveLength(1)
          const record = draft.evidence[0]!
          expect(record.kind).toBe("file-operation")
          expect(record.facts.kind).toBe("create")
          expect(record.id).toBe(operation.evidenceIds[0])
        }),
      ),
    60_000,
  )

  effect(
    "delete proposes a delete operation guarded by the current content hash",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const source = yield* project.sourceText("src/library.ts")
          const draft = yield* Draft.files.delete(project, "src/library.ts")
          const operation = expectKind(draft.fileOperations![0]!, "delete")
          expect(operation.path).toBe("src/library.ts")
          expect(operation.initialHash).toBe(hash("sha256", source, "hex"))
          expect(draft.evidence[0]!.id).toBe(operation.evidenceIds[0])
        }),
      ),
    60_000,
  )

  effect(
    "move carries the source text unchanged in the operation content, not as edits",
    () =>
      withProject(
        {
          "src/lib.ts": "export const A = 1\n",
          "src/host.ts": 'import { A } from "./lib.js";\nexport const h = A;\n',
        },
        (project) =>
          Effect.gen(function* () {
            const source = yield* project.sourceText("src/host.ts")
            const draft = yield* Draft.files.move(project, "src/host.ts", "src/nested/host.ts")

            expect(draft.edits).toEqual([])
            const operation = expectKind(draft.fileOperations![0]!, "move")
            expect(operation.path).toBe("src/host.ts")
            expect(operation.toPath).toBe("src/nested/host.ts")
            expect(operation.content).toBe(source)
            expect(operation.initialHash).toBe(hash("sha256", source, "hex"))
          }),
      ),
    60_000,
  )
})
