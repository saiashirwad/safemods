/**
 * Migrate the callback overloads of `lookup` to their promise/options form. A call is migrated
 * when the checker resolves it to an overload whose last parameter is callable, so aliases and
 * re-exported receivers are followed and same-named methods are ignored. Spreads are reported
 * rather than guessed at.
 */
import { Effect } from "effect"
import type { Node } from "typescript/unstable/ast"
import { isFunctionDeclaration, isSpreadElement } from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface OverloadedMethodInput {
  readonly project: ConfiguredProject.Type
}

const takesCallbackLast = ({ project, value }: Query.Selection<Node>) =>
  Effect.gen(function* () {
    const signature = yield* project.signatureOf(value)
    if (signature === undefined) return false
    const last = (yield* project.parameterTypesOf(signature)).at(-1)
    return last !== undefined && (yield* project.callSignaturesOf(last)).length > 0
  })

export const overloadedMethod = Recipe.define("overloaded-method", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: OverloadedMethodInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)
      const callbackOverloads = yield* Query.nodes(project, isFunctionDeclaration).pipe(
        Query.within("src/legacy-client.ts"),
        Query.filter(({ value }) => value.name?.text === "lookup" && value.body === undefined),
        Query.where(takesCallbackLast),
        Query.collect,
      )
      const calls = yield* Query.calls(project).pipe(
        Query.where(Query.resolvesToSignature(callbackOverloads.map(({ value }) => value))),
        Query.collect,
      )

      return Draft.concat(
        ...calls.map((selection) => {
          const call = selection.value
          if (call.arguments.some(isSpreadElement)) {
            return Draft.unsupported(selection, "spread arguments prevent overload selection")
          }
          const callback = call.arguments.at(-1)!.getText()
          const options = call.arguments.length === 3 ? call.arguments[1]!.getText() : "{}"
          return Draft.replaceSelection(
            selection,
            `${call.expression.getText()}(${call.arguments[0]!.getText()}, ${options}).then((result) => ${callback}(null, result), ${callback})`,
          )
        }),
      )
    }),
})
