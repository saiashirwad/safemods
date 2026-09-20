import { Effect } from "effect"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"

export const importCycles = (options: { readonly within: string; readonly typeImports: boolean }) =>
  Check.perProject("import-cycles", (project) =>
    Query.resolvedModuleReferences(project).pipe(
      Query.within(options.within),
      Query.filter(
        ({ value }) => (options.typeImports || !value.typeOnly) && value.resolved !== undefined,
      ),
      Query.collect,
      Effect.map((references) => {
        const edges = Map.groupBy(references, (reference): string => reference.fileName)
        const reaches = (from: string, to: string, seen = new Set<string>()): boolean =>
          (edges.get(from) ?? []).some(({ value }) => {
            const next = value.resolved!.fileName
            if (next === to) return true
            if (seen.has(next)) return false
            seen.add(next)
            return reaches(next, to, seen)
          })
        return references
          .filter(({ fileName, value }) => reaches(value.resolved!.fileName, fileName))
          .map((reference) =>
            Check.report(
              reference,
              `imports ${reference.value.resolved!.fileName}, which leads back to this file: move what both need into a module neither imports`,
            ),
          )
      }),
    ),
  )
