import { Effect, Option } from "effect"
import type { Node } from "typescript/unstable/ast"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"

export const unusedCode = (options: {
  readonly within: string
  readonly tests: string
  readonly publicApi: ReadonlyArray<string>
}) =>
  Check.perProject("unused-code", (project) =>
    Effect.gen(function* () {
      const isPublic = yield* Query.publicSymbols(project, options.publicApi)
      const isTest = (node: Node): boolean =>
        Option.exists(
          project.fileNameOf(node.getSourceFile()),
          (fileName) => Query.isWithin(fileName, options.tests),
        )
      return yield* Check.each(
        yield* Query.files(project, [options.within]),
        (file) =>
          Effect.flatMap(project.exportsOf(file), (exported) =>
            Check.each(
              exported.filter(({ symbol }) => !isPublic.has(symbol)),
              ({ name, symbol }) =>
                Effect.gen(function* () {
                  const declaration = yield* Query.declarationIn(project, symbol, file)
                  const named = declaration === undefined ?
                    undefined :
                    Query.nameOf(declaration.value)
                  if (declaration === undefined || named === undefined) return []
                  const uses = (yield* project.referencesTo(named)).filter((use) => use !== named)
                  if (uses.length === 0) {
                    return [Check.report(declaration, `${name} is never used: delete it`)]
                  }
                  return uses.every(isTest) ?
                    [
                      Check.report(
                        declaration,
                        `${name} is used only by tests: delete it with its tests, or make it part of the public API`,
                      ),
                    ] :
                    []
                }),
            )),
        8,
      )
    }))
