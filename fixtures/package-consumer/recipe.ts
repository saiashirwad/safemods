import { Effect } from "effect"
import { isDebuggerStatement } from "typescript/unstable/ast/is"
import { Proposal, Query, Recipe } from "safemods"

export default Recipe.perProject("remove-debugger", {
  version: "1.0.0",
  run: (project, input) =>
    Effect.gen(function* () {
      if (input !== undefined) throw new Error("absent input must be undefined")
      const statements = yield* Query.nodes(project, isDebuggerStatement)
      return Proposal.concat(...statements.map(({ value }) => Proposal.remove(project, value)))
    }),
})
