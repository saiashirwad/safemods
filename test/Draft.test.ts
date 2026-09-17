import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../src/Draft.ts"
import { applyFileEdits } from "../src/Edit.ts"
import * as Query from "../src/Query.ts"
import { projectPath } from "./utils/domain.ts"
import { withProject } from "./utils/fixture.ts"

const ARGUMENTS_SOURCE = [
  "declare function run(...values: Array<number>): number",
  "export const result = run(1, 2, 3)",
  "",
].join("\n")

describe("drafts", () => {
  effect("replace, insert, and remove produce hash-guarded edits at the node's range", () =>
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
        expect(yield* applyFileEdits(ARGUMENTS_SOURCE, draft.edits)).toContain(
          "run(10, /* before */ 2 /* after */, )",
        )
      }),
    ),
  )

  effect("replaces a selection-relative range", () =>
    withProject({ "src/arguments.ts": ARGUMENTS_SOURCE }, (project) =>
      Effect.gen(function* () {
        const [call] = yield* Query.calls(project).pipe(
          Query.within("src/arguments.ts"),
          Query.collect,
        )
        const text = call!.value.getText()
        const draft = Draft.replaceRange(
          call!,
          { start: text.indexOf("1, 2, 3"), end: text.indexOf("1, 2, 3") + 7 },
          "options",
        )
        expect(yield* applyFileEdits(ARGUMENTS_SOURCE, draft.edits)).toContain("run(options)")
      }),
    ),
  )

  effect("replaceEach replaces every selected node", () =>
    withProject({ "src/arguments.ts": ARGUMENTS_SOURCE }, (project) =>
      Effect.gen(function* () {
        const calls = yield* Query.calls(project).pipe(
          Query.within("src/arguments.ts"),
          Query.collect,
        )
        const draft = Draft.replaceEach(calls, () => "run()")
        expect(draft.edits).toHaveLength(1)
        expect(yield* applyFileEdits(ARGUMENTS_SOURCE, draft.edits)).toContain("result = run()")
      }),
    ),
  )

  effect("creates file operations from project files", () =>
    withProject({}, (project) =>
      Effect.gen(function* () {
        const library = (yield* project.file(projectPath("src/library.ts")))!
        const target = projectPath("src/nested/library.ts")

        expect(Draft.deleteFile(library).fileOperations).toEqual([
          {
            kind: "delete",
            projectId: "app",
            fileName: "src/library.ts",
          },
        ])
        expect(Draft.moveFile(library, target).fileOperations).toEqual([
          {
            kind: "move",
            projectId: "app",
            fileName: "src/library.ts",
            toFileName: target,
          },
        ])
        expect(Draft.createFile(project, target, "export {}\n").fileOperations).toEqual([
          {
            kind: "create",
            projectId: "app",
            fileName: target,
            content: "export {}\n",
          },
        ])
      }),
    ),
  )
})
