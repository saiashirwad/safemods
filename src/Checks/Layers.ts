import { Effect } from "effect"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"

export const layers = (options: {
  readonly within: string
  readonly order: ReadonlyArray<ReadonlyArray<string>>
}) => {
  const rowOf = (fileName: string): number | undefined => {
    const row = options.order.findIndex((entries) =>
      entries.some((entry) => entry.endsWith("/") ? fileName.startsWith(entry) : fileName === entry)
    )
    return row === -1 ? undefined : row
  }

  return Check.perProject("layers", (project) =>
    Query.resolvedModuleReferences(project).pipe(
      Query.within(options.within),
      Query.collect,
      Effect.map((references) =>
        references.flatMap((reference) => {
          const target = reference.value.resolved?.fileName
          const from = rowOf(reference.fileName)
          const to = target === undefined ? undefined : rowOf(target)
          return from === undefined || to === undefined || to <= from ?
            [] :
            [Check.report(reference, `imports ${target}, which is listed below it`)]
        })
      ),
    ))
}
