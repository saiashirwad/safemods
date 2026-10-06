/**
 * Rewrite CRLF line endings to LF in every source file of every project.
 */
import { Proposal, Recipe } from "safemods"
import { Effect } from "effect"

export const normalizeLineEndings = Recipe.perProject("normalize-line-endings", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (project) =>
    Effect.gen(function* () {
      const files = yield* project.files
      return Proposal.concat(
        ...files
          .filter((file) => file.sourceFile.text.includes("\r\n"))
          .map((file) => Proposal.replaceText(file, file.sourceFile.text.replaceAll("\r\n", "\n"))),
      )
    }),
})

export default normalizeLineEndings
