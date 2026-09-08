import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../src/Draft/index.ts"
import { requireProjectRelativePath } from "../src/ProjectPath.ts"
import * as Query from "../src/Query/index.ts"
import { Workspace } from "../src/Workspace/index.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"

const expectCompleteEvidence = (draft: Draft.Draft): void => {
  const evidenceIds = draft.evidence.map((record) => record.id)
  expect(new Set(evidenceIds).size).toBe(evidenceIds.length)

  const referencedIds = [
    ...draft.edits.flatMap((edit) => edit.evidenceIds),
    ...(draft.fileOperations ?? []).flatMap((operation) => operation.evidenceIds),
  ]
  for (const id of referencedIds) {
    expect(evidenceIds.filter((candidate) => candidate === id)).toHaveLength(1)
    expect(draft.evidence.find((record) => record.id === id)?.facts).not.toEqual({})
  }
}

describe("Draft helper contracts", () => {
  effect(
    "aligns replace, insert, and remove matches and gives operation edits complete, unique evidence",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise(() =>
            Fs.writeFile(
              Path.join(root, "src/arguments.ts"),
              [
                "declare function run(...values: Array<number>): number",
                "export const result = run(1, 2, 3)",
                "",
              ].join("\n"),
            ),
          )

          const workspace = yield* Workspace
          yield* workspace.withSnapshot(
            {},
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              const calls = yield* Query.calls(project).pipe(
                Query.within("src/arguments.ts"),
                Query.collect,
              )
              const call = calls.find((selection) => selection.value.arguments.length === 3)?.value
              expect(call).toBeDefined()
              if (call === undefined) return

              const firstArg = call.arguments[0]!
              const secondArg = call.arguments[1]!
              const thirdArg = call.arguments[2]!
              const drafts = [
                yield* Draft.replace(project, firstArg, "10"),
                yield* Draft.insertBefore(project, secondArg, "/* before */ "),
                yield* Draft.insertAfter(project, secondArg, " /* after */"),
                yield* Draft.remove(project, thirdArg),
              ]
              for (const draft of drafts) {
                expect(draft.matches).toBe(1)
                expect(draft.edits).toHaveLength(1)
                expectCompleteEvidence(draft)
              }
              expectCompleteEvidence(yield* Draft.concat(...drafts))
              expectCompleteEvidence(yield* Draft.concat({ ...drafts[0]!, evidence: [] }))

              const emptyEach = yield* Draft.replaceEach(calls.slice(0, 1), () => Draft.empty)
              expect(emptyEach.edits).toEqual([])
              expect(emptyEach.matches).toBe(1)
              expect(emptyEach.evidence).toHaveLength(1)
              expect(emptyEach.evidence[0]?.kind).toBe("selection")

              const createEvidence = (projectId: string): Draft.Draft => ({
                edits: [],
                fileOperations: [
                  {
                    kind: "create",
                    projectId,
                    path: requireProjectRelativePath("src/a.ts"),
                    content: projectId,
                    evidenceIds: [`file:create:${projectId}:src/a.ts`],
                  },
                ],
                evidence: [
                  {
                    id: `file:create:${projectId}:src/a.ts`,
                    kind: "file-operation",
                    facts: { kind: "create", projectId, path: "src/a.ts" },
                  },
                ],
                matches: 1,
              })
              const mergedProjects = yield* Draft.concat(
                createEvidence("app"),
                createEvidence("lib"),
              )
              expect(mergedProjects.evidence.map((record) => record.id).sort()).toEqual([
                "file:create:app:src/a.ts",
                "file:create:lib:src/a.ts",
              ])
              const sameTwice = yield* Draft.concat(createEvidence("app"), createEvidence("app"))
              expect(sameTwice.evidence).toHaveLength(1)
              const conflictingConcat = yield* Draft.concat(createEvidence("app"), {
                ...createEvidence("app"),
                evidence: [
                  {
                    id: "file:create:app:src/a.ts",
                    kind: "file-operation",
                    facts: { kind: "delete", projectId: "app", path: "src/a.ts" },
                  },
                ],
              }).pipe(Effect.flip)
              expect(conflictingConcat._tag).toBe("DraftEvidenceConflict")

              const sameRange = calls[0]!
              const firstAudit = yield* Draft.audit([sameRange])
              const secondSelection = {
                ...sameRange,
                evidence: [{ criterion: "other", facts: { extra: true } }],
              }
              const conflictingAudit = yield* Draft.audit([sameRange, secondSelection]).pipe(
                Effect.flip,
              )
              expect(conflictingAudit._tag).toBe("DraftEvidenceConflict")
              const sameAudit = yield* Draft.audit([sameRange, sameRange])
              expect(sameAudit.matches).toBe(1)
              expect(sameAudit.evidence).toHaveLength(1)
              expect(firstAudit.evidence[0]?.id).toBe(sameAudit.evidence[0]?.id)

              const conflictingEach = yield* Draft.replaceEach(calls.slice(0, 1), (selection) => ({
                edits: [],
                evidence: [
                  {
                    id: `selection:${selection.project.project.id}:${selection.fileName}:${selection.start}-${selection.end}`,
                    kind: "selection",
                    facts: { other: true },
                  },
                ],
                matches: 1,
              })).pipe(Effect.flip)
              expect(conflictingEach._tag).toBe("DraftEvidenceConflict")
            }),
          )
        }),
      ),
    60_000,
  )
})
