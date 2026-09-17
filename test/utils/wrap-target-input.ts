import { Effect } from "effect"
import { isObjectLiteralExpression } from "typescript/unstable/ast/is"
import * as Draft from "../../src/Draft.ts"
import type * as ProjectRelativePath from "../../src/ProjectRelativePath.ts"
import * as Query from "../../src/Query.ts"
import * as Recipe from "../../src/Recipe.ts"
import { type ConfiguredProject, WorkspaceSnapshot } from "../../src/Workspace/index.ts"

export interface WrapTargetInput {
  readonly project: ConfiguredProject.Type
  readonly declarationFile: ProjectRelativePath.Type
  readonly property: string
}

export const wrapTargetInput = Recipe.define("wrap-target-input", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: WrapTargetInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project)

      const target = yield* project.symbolNamed("target", { within: input.declarationFile })

      const matches = yield* Query.calls(project).pipe(
        Query.where(Query.resolvesTo(target, { location: (call) => call.expression })),
        Query.filter(
          ({ value: call }) =>
            call.arguments.length === 1 && !isObjectLiteralExpression(call.arguments[0]!),
        ),
        Query.collect,
      )

      return Draft.concat(
        ...matches.map(({ project, value: call }) => {
          const argument = call.arguments[0]!
          return Draft.replace(project, argument, `{ ${input.property}: ${argument.getText()} }`)
        }),
      )
    }),
})
