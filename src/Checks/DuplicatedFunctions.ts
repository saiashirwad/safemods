import { Effect } from "effect"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"

const bodyOf = ({ value }: Query.Selection<Query.NamedFunction>): string => {
  const text = value.node.getText()
  return text.slice(text.indexOf("("))
}

export const duplicatedFunctions = (options: {
  readonly within: string
  readonly minimumLength: number
}) =>
  Check.perProject("duplicated-functions", (project) =>
    Query.namedFunctions(project).pipe(
      Query.within(options.within),
      Query.filter((selection) => bodyOf(selection).length >= options.minimumLength),
      Query.collect,
      Effect.map((functions) =>
        [...Map.groupBy(functions, bodyOf).values()].flatMap((copies) => {
          const files = [...new Set(copies.map((copy) => copy.fileName))]
          return files.length < 2
            ? []
            : copies.map((copy) =>
                Check.report(
                  copy,
                  `${copy.value.name.text} is written out in ${files.length} files (${files.filter((file) => file !== copy.fileName).join(", ")}): keep one and import it`,
                ),
              )
        }),
      ),
    ),
  )
