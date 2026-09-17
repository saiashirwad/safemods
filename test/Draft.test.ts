import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../src/Draft.ts"
import { applyFileEdits } from "../src/Edit.ts"
import * as Query from "../src/Query.ts"
import * as Sha256 from "../src/Sha256.ts"
import { projectPath } from "./utils/domain.ts"
import { withProject } from "./utils/fixture.ts"

const ARGUMENTS_SOURCE = [
  "declare function run(...values: Array<number>): number",
  "export const result = run(1, 2, 3)",
  "",
].join("\n")

describe("drafts", () => {
  effect(
    "replace, insert, and remove produce hash-guarded edits at the node's range",
    () =>
      withProject({ "src/arguments.ts": ARGUMENTS_SOURCE }, (project) =>
        Effect.gen(function* () {
          const [call] = yield* Query.calls(project).pipe(
            Query.within("src/arguments.ts"),
            Query.collect,
          )
          const [first, second, third] = call!.value.arguments
          const draft = Draft.concat(
            Draft.replace(project, first!, "10"),
            Draft.insertBefore(project, second!, "/* before */ "),
            Draft.insertAfter(project, second!, " /* after */"),
            Draft.remove(project, third!),
          )
          expect(draft.matches).toBe(4)
          expect(yield* applyFileEdits(ARGUMENTS_SOURCE, draft.edits)).toContain(
            "run(10, /* before */ 2 /* after */, )",
          )
        }),
      ),
    60_000,
  )

  effect(
    "replaceEach cites each selection's query evidence, even when nothing is edited",
    () =>
      withProject({ "src/arguments.ts": ARGUMENTS_SOURCE }, (project) =>
        Effect.gen(function* () {
          const calls = yield* Query.calls(project).pipe(
            Query.within("src/arguments.ts"),
            Query.collect,
          )
          const replaced = Draft.replaceEach(calls, () => "run()")
          expect(replaced.matches).toBe(1)
          expect(replaced.edits[0]!.evidenceIds).toEqual([replaced.evidence[0]!.id])
          expect(replaced.evidence[0]!.facts.criteria).toEqual([
            { criterion: "syntax-kind", facts: { kind: "CallExpression" } },
          ])

          const untouched = Draft.replaceEach(calls, () => Draft.empty)
          expect(untouched.edits).toEqual([])
          expect(untouched.matches).toBe(1)
          expect(untouched.evidence).toEqual(replaced.evidence)

          expect(Draft.concat(replaced, untouched).evidence).toEqual(replaced.evidence)
        }),
      ),
    60_000,
  )

  effect(
    "file operations guard existing files by content hash",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const library = (yield* project.file(projectPath("src/library.ts")))!
          const initialHash = Sha256.digest(library.sourceFile.text)
          const target = projectPath("src/nested/library.ts")

          expect(Draft.deleteFile(library).fileOperations).toEqual([
            {
              kind: "delete",
              projectId: "app",
              fileName: "src/library.ts",
              initialHash,
              evidenceIds: [],
            },
          ])
          expect(Draft.moveFile(library, target).fileOperations).toEqual([
            {
              kind: "move",
              projectId: "app",
              fileName: "src/library.ts",
              toFileName: target,
              initialHash,
              evidenceIds: [],
            },
          ])
          expect(Draft.createFile(project, target, "export {}\n").fileOperations).toEqual([
            {
              kind: "create",
              projectId: "app",
              fileName: target,
              content: "export {}\n",
              evidenceIds: [],
            },
          ])
        }),
      ),
    60_000,
  )
})
