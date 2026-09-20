import { Effect, Option } from "effect"
import { SymbolFlags } from "typescript/unstable/async"
import * as Check from "../Check.ts"
import * as Type from "../Type.ts"
import { publicSymbols } from "./Exported.ts"
import * as Query from "../Query.ts"

export const anyInPublicApi = (options: { readonly publicApi: ReadonlyArray<string> }) =>
  Check.perProject("any-in-public-api", (project) =>
    Effect.gen(function* () {
      const published = yield* publicSymbols(project, options.publicApi)
      return yield* Check.each(
        [...published].filter((symbol) => (symbol.flags & SymbolFlags.Module) === 0),
        (symbol) =>
          Effect.gen(function* () {
            const type = yield* Type.ofSymbol(project, symbol)
            const [declaration] = yield* project.declarationsOf(symbol)
            if (type === undefined || declaration === undefined) return []
            const leaked = yield* Type.mentions(project, type, (candidate) =>
              Effect.succeed(Type.isAny(candidate)),
            )
            return Option.isNone(leaked)
              ? []
              : Option.toArray(Query.selectionOf(project, declaration)).map((at) =>
                  Check.report(
                    at,
                    `${symbol.name} is public and its type contains any: callers lose checking through it`,
                  ),
                )
          }),
        8,
      )
    }),
  )
