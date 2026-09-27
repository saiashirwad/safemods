/**
 * Rewrite CRLF line endings to LF in every source file of every project.
 */
import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

export const normalizeLineEndings = Recipe.define("normalize-line-endings", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const files = yield* Effect.forEach(snapshot.projects, (project) => project.files)
      return Draft.concat(
        ...files
          .flat()
          .filter((file) => file.sourceFile.text.includes("\r\n"))
          .map((file) => Draft.replaceText(file, file.sourceFile.text.replaceAll("\r\n", "\n"))),
      )
    }),
})
