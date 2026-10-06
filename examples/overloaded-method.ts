/**
 * Migrate the callback overloads of `lookup` to their promise/options form. A call is migrated
 * when the checker resolves it to an overload whose last parameter is callable, so aliases and
 * re-exported receivers are followed and same-named methods are ignored. Spreads are reported
 * rather than guessed at.
 */
import { Proposal, Pattern as P, Query, Recipe, type Workspace } from "safemods"
import { Effect } from "effect"
import type { CallExpression, Node } from "typescript/unstable/ast"
import {
  isCallExpression,
  isFunctionDeclaration,
  isSpreadElement,
} from "typescript/unstable/ast/is"

export interface OverloadedMethodInput {
  readonly project: Workspace.ConfiguredProject.Type
}

const takesCallbackLast = ({ project, value }: Query.Selection<Node>) =>
  Effect.gen(function* () {
    const signature = yield* project.signatureOf(value)
    if (signature === undefined) return false
    const last = (yield* project.parameterTypesOf(signature)).at(-1)
    return last !== undefined && (yield* project.callSignaturesOf(last)).length > 0
  })

const callbackCall = P.tagged({
  withOptions: P.node(isCallExpression, {
    arguments: [P.capture("key"), P.capture("options"), P.capture("callback")],
  }),
  withoutOptions: P.node(isCallExpression, {
    arguments: [P.capture("key"), P.capture("callback")],
  }),
})

const promiseForm = (call: CallExpression): string | undefined => {
  if (call.arguments.some(isSpreadElement)) return undefined
  const matched = callbackCall(call)
  if (matched === undefined) return undefined
  const { key, callback } = matched.captures
  const options = matched._tag === "withOptions" ? matched.captures.options.getText() : "{}"
  const done = callback.getText()
  return `${call.expression.getText()}(${key.getText()}, ${options}).then((result) => ${done}(null, result), ${done})`
}

export const overloadedMethod = Recipe.define("overloaded-method", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (snapshot, input: OverloadedMethodInput) =>
    Effect.gen(function* () {
      const project = yield* snapshot.project(input.project.id)
      const callbackOverloads = yield* Query.nodes(project, isFunctionDeclaration).pipe(
        Query.within("src/legacy-client.ts"),
        Query.filter(({ value }) => value.name?.text === "lookup" && value.body === undefined),
        Query.where(takesCallbackLast),
      )
      const calls = yield* Query.calls(project).pipe(
        Query.where(Query.resolvesToSignature(callbackOverloads)),
      )

      return Proposal.concat(
        ...calls.map((selection) => {
          const replacement = promiseForm(selection.value)
          return replacement === undefined ?
            Proposal.unsupported(selection, "spread arguments prevent overload selection") :
            Proposal.replaceSelection(selection, replacement)
        }),
      )
    }),
})

export default overloadedMethod
