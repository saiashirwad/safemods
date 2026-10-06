/**
 * Mark a promise that a statement drops on the floor with `void`, so the choice not to await
 * it is visible. A call counts when the checker gives it a type with a `then` member.
 */
import { Proposal, Query, Recipe } from "safemods"
import { Effect } from "effect"
import { isExpressionStatement } from "typescript/unstable/ast/is"

export const voidFloatingPromises = Recipe.perProject("void-floating-promises", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (project) =>
    Effect.gen(function* () {
      const floating = yield* Query.calls(project).pipe(
        Query.filter(({ value }) => isExpressionStatement(value.parent)),
        Query.typed,
        Query.where(({ value }) =>
          Effect.map(project.propertyOf(value.type, "then"), (then) => then !== undefined)
        ),
      )
      return Proposal.concat(
        ...floating.map(({ project, value }) =>
          Proposal.insertBefore(project, value.node, "void ")
        ),
      )
    }),
})

export default voidFloatingPromises
