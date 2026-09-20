import { Effect } from "effect"
import { isSpreadElement } from "typescript/unstable/ast/is"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"
import { publicSymbols } from "./Exported.ts"

export const unusedOptionalParameters = (options: {
  readonly within: string
  readonly publicApi: ReadonlyArray<string>
}) =>
  Check.perProject("unused-optional-parameters", (project) =>
    Effect.gen(function* () {
      const isPublic = yield* publicSymbols(project, options.publicApi)
      const functions = yield* Query.namedFunctions(project).pipe(
        Query.within(options.within),
        Query.collect,
      )
      return yield* Check.each(functions, (selection) =>
        Effect.gen(function* () {
          const optional = selection.value.node.parameters.flatMap((parameter, index) =>
            parameter.dotDotDotToken === undefined &&
              (parameter.questionToken !== undefined || parameter.initializer !== undefined) ?
              [{ index, name: parameter.name.getText() }] :
              []
          )
          if (optional.length === 0) return []
          const name = { ...selection, value: selection.value.name }
          const symbol = yield* project.symbolOf(name.value)
          if (symbol !== undefined && isPublic.has(yield* project.canonicalSymbol(symbol))) {
            return []
          }
          const { calls, escapes } = yield* Query.usesOf(name)
          if (escapes || calls.length === 0) return []
          if (calls.some(({ value }) => value.arguments.some(isSpreadElement))) return []
          return optional
            .filter(({ index }) => calls.every(({ value }) => value.arguments.length <= index))
            .map((parameter) =>
              Check.report(
                name,
                `no caller passes ${parameter.name} in ${calls.length} call(s): remove the parameter`,
              )
            )
        }))
    }))
