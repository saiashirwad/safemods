/**
 * Delete `debugger` statements. The line they stood on is left blank for the formatter.
 */
import { Proposal, Query, Recipe } from "safemods"
import { Effect } from "effect"
import { isDebuggerStatement } from "typescript/unstable/ast/is"

export const removeDebugger = Recipe.perProject("remove-debugger", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (project) =>
    Effect.gen(function* () {
      const statements = yield* Query.nodes(project, isDebuggerStatement)
      return Proposal.concat(
        ...statements.map(({ project, value }) => Proposal.remove(project, value)),
      )
    }),
})

export default removeDebugger
