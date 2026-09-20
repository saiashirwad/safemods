import { Effect } from "effect"
import { isExpressionStatement } from "typescript/unstable/ast/is"
import { TypeFlags } from "typescript/unstable/async"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"

const nothing = TypeFlags.Void | TypeFlags.Undefined | TypeFlags.Never

export const ignoredReturns = (options: { readonly within: string }) =>
  Check.perProject("ignored-returns", (project) =>
    Query.namedFunctions(project).pipe(
      Query.within(options.within),
      Query.collect,
      Effect.flatMap((functions) =>
        Check.each(functions, (selection) =>
          Effect.gen(function* () {
            const name = { ...selection, value: selection.value.name }
            const { calls, escapes } = yield* Query.usesOf(name)
            if (escapes || calls.length < 2) return []
            if (!calls.every(({ value }) => isExpressionStatement(value.parent))) return []
            const signature = yield* project.signatureOf(selection.value.node)
            const returned = signature === undefined ?
              undefined :
              yield* project.returnTypeOf(signature)
            if (returned === undefined || (returned.flags & nothing) !== 0) return []
            return [
              Check.report(
                name,
                `returns ${yield* project.typeToString(
                  returned,
                )}, which all ${calls.length} callers ignore: return nothing`,
              ),
            ]
          }))
      ),
    ))
