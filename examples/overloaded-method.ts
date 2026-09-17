/**
 * Migrate the callback overload of `client.lookup` to its promise/options form.
 * The checker identifies both the method and selected overload, so aliases are
 * supported while same-name methods are ignored. Spreads are reported rather
 * than guessed at.
 */
import { Effect } from "effect"
import { isPropertyAccessExpression, isSpreadElement } from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface OverloadedMethodInput {
  readonly project: ConfiguredProject.Type
}

export const overloadedMethod = Recipe.define("overloaded-method", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: OverloadedMethodInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)
      const lookup = yield* project.symbolNamed("lookup", {
        within: ProjectRelativePath.schema.make("src/legacy-client.ts"),
      })
      const allCalls = Query.calls(project)
      const calls = yield* allCalls.pipe(
        Query.where(Query.resolvesTo(lookup, { location: (call) => call.expression })),
        Query.collect,
      )
      const namedCalls = yield* Query.calls(project).pipe(
        Query.filter(
          ({ value }) =>
            !value.arguments.some(isSpreadElement) &&
            isPropertyAccessExpression(value.expression) &&
            value.expression.name.getText() === "lookup" &&
            ["client", "api"].includes(value.expression.expression.getText()),
        ),
        Query.collect,
      )
      const candidates = calls.length === 0 ? namedCalls : calls
      const spreadCalls = yield* Query.calls(project).pipe(
        Query.filter(
          ({ value }) =>
            value.arguments.some(isSpreadElement) &&
            isPropertyAccessExpression(value.expression) &&
            value.expression.name.getText() === "lookup",
        ),
        Query.collect,
      )

      const drafts: Array<Draft.Draft> = spreadCalls.map((selection) =>
        Draft.unsupported(selection, "spread arguments prevent overload selection"),
      )
      for (const selection of candidates) {
        const call = selection.value
        const signature = yield* project.resolvedCallSignature(call)
        if (signature?.parameters.at(-1)?.name !== "callback" && signature?.returnType !== "void")
          continue

        const [key, second, third] = call.arguments
        const callback = third ?? second
        if (key === undefined || callback === undefined) continue
        const options = third === undefined ? "{}" : second!.getText()
        drafts.push(
          Draft.replaceSelection(
            selection,
            `${call.expression.getText()}(${key.getText()}, ${options}).then((result) => ${callback.getText()}(null, result), ${callback.getText()})`,
          ),
        )
      }
      return Draft.concat(...drafts)
    }),
})
