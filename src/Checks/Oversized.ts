import { Effect } from "effect"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"
import { filesWithin } from "./Exported.ts"

const linesOf = (text: string): number => text.split("\n").length

export const oversized = (options: {
  readonly within: string
  readonly functionLines: number
  readonly parameters: number
  readonly fileLines: number
}) =>
  Check.perProject("oversized", (project) =>
    Effect.gen(function* () {
      const files = yield* filesWithin(project, [options.within])
      const functions = yield* Query.namedFunctions(project).pipe(
        Query.within(options.within),
        Query.collect,
      )
      return [
        ...files
          .filter((file) => linesOf(file.sourceFile.text) > options.fileLines)
          .map((file) =>
            Check.reportAt(
              project,
              file.fileName,
              `${linesOf(file.sourceFile.text)} lines, over the limit of ${options.fileLines}: split it by responsibility`,
            ),
          ),
        ...functions.flatMap((selection) => {
          const { node, name } = selection.value
          const lines = linesOf(node.getText())
          return [
            ...(lines > options.functionLines
              ? [
                  Check.report(
                    selection,
                    `${name.text} is ${lines} lines, over the limit of ${options.functionLines}: extract named steps`,
                  ),
                ]
              : []),
            ...(node.parameters.length > options.parameters
              ? [
                  Check.report(
                    selection,
                    `${name.text} takes ${node.parameters.length} parameters, over the limit of ${options.parameters}: pass one options object`,
                  ),
                ]
              : []),
          ]
        }),
      ]
    }),
  )
