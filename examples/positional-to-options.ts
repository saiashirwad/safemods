/**
 * Wrap `createSession(userId, ttlSeconds)` call sites that resolve to the
 * canonical export in `src/sessions.ts`. Already-object calls and locals of
 * the same name are left alone. Argument trivia is preserved.
 */
import { Effect } from "effect"
import { isObjectLiteralExpression } from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface PositionalToOptionsInput {
  readonly project: ConfiguredProject.Type
}

export const positionalToOptions = Recipe.define("positional-to-options", {
  version: "1.0.0",
  policies: { matchCount: { min: 1 }, idempotence: "required" },
  run: (input: PositionalToOptionsInput) =>
    Effect.gen(function* () {
      // TODO: potentially unify the next 2 lines if this is always the only access pattern
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project)
      const createSession = yield* project.symbolNamed("createSession", {
        within: ProjectRelativePath.schema.make("src/sessions.ts"),
      })

      const matches = yield* Query.calls(project).pipe(
        Query.where(Query.resolvesTo(createSession, { location: (call) => call.expression })),
        Query.filter(({ value: call }) => {
          const [userId] = call.arguments
          return (
            call.arguments.length === 2 &&
            userId !== undefined &&
            !isObjectLiteralExpression(userId)
          )
        }),
        Query.collect,
      )

      return yield* Draft.replaceEach(matches, ({ value: call }) => {
        const sourceFile = call.getSourceFile()
        const userId = call.arguments[0]!
        const ttlSeconds = call.arguments[1]!
        const before = sourceFile.text.slice(call.getStart(sourceFile), userId.getStart(sourceFile))
        const after = sourceFile.text.slice(ttlSeconds.getEnd(), call.getEnd())
        return `${before}{ userId: ${userId.getText()}, ttlSeconds: ${ttlSeconds.getText()} }${after}`
      })
    }),
})
