/**
 * Mark a promise that a statement drops on the floor with `void`, so the choice not to await
 * it is visible. A call counts when the checker gives it a type with a `then` member.
 */
import { Effect } from "effect"
import { isExpressionStatement } from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

export const voidFloatingPromises = Recipe.define("void-floating-promises", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const floating = yield* Effect.forEach(snapshot.projects, (project) =>
        Query.calls(project).pipe(
          Query.filter(({ value }) =>
            isExpressionStatement(value.parent)
          ),
          Query.typed,
          Query.where(({ value }) =>
            Effect.map(project.propertyOf(value.type, "then"), (then) => then !== undefined)
          ),
        ))
      return Draft.concat(
        ...floating.flat().map(({ project, value }) =>
          Draft.insertBefore(project, value.node, "void ")
        ),
      )
    }),
})
