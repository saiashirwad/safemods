import { Effect } from "effect"
import * as Check from "../Check.ts"
import * as Query from "../Query/index.ts"

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
    Query.files(project, [options.within]).pipe(
      Effect.flatMap(Query.resolvedModuleReferences),
      Effect.map((references) =>
        references.flatMap((reference) => {
          const target = reference.value.resolved?.fileName
          const from = rowOf(reference.fileName)
          const to = target === undefined ? undefined : rowOf(target)
          // mutant: layers-same-layer
          return from === undefined || to === undefined || to <= from ?
            [] :
            [
              Check.report(
                reference,
                `imports ${target}, which the layers check in safemods.config.ts lists below this file: move the import, or move the module to a higher layer`,
              ),
            ]
        })
      ),
    ))
}
