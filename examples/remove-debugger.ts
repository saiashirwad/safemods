/**
 * Delete `debugger` statements. The line they stood on is left blank for the formatter.
 */
import { Effect } from "effect"
import { isDebuggerStatement } from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

export const removeDebugger = Recipe.define("remove-debugger", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const statements = yield* Effect.forEach(snapshot.projects, (project) =>
        Query.collect(Query.nodes(project, isDebuggerStatement)))
      return Draft.concat(
        ...statements.flat().map(({ project, value }) =>
          Draft.remove(project, value)
        ),
      )
    }),
})
