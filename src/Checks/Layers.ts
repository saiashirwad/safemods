import { Effect } from "effect"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"
import { WorkspaceSnapshot } from "../Workspace/index.ts"

export const layers = (options: {
  readonly within: string
  readonly order: ReadonlyArray<ReadonlyArray<string>>
}) => {
  const rowOf = (fileName: string): number | undefined => {
    const row = options.order.findIndex((entries) =>
      entries.some((entry) =>
        entry.endsWith("/") ? fileName.startsWith(entry) : fileName === entry,
      ),
    )
    return row === -1 ? undefined : row
  }

  return Check.define(
    "layers",
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const references = yield* Effect.forEach(snapshot.projects, (project) =>
        Query.resolvedModuleReferences(project).pipe(Query.within(options.within), Query.collect),
      )
      return references.flat().flatMap((selection) => {
        const target = selection.value.resolved?.fileName
        const from = rowOf(selection.fileName)
        const to = target === undefined ? undefined : rowOf(target)
        return from === undefined || to === undefined || to <= from
          ? []
          : [Check.report(selection, `imports ${target}, which is listed below it`)]
      })
    }),
  )
}
