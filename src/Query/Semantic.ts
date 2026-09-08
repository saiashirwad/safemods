/** TypeScript semantic and declaration criteria. */
import { Effect } from "effect"
import type { Node } from "typescript/unstable/ast"
import type { Symbol as NativeSymbol, Type as NativeType } from "typescript/unstable/async"
import type { ProjectSnapshotError } from "../Workspace/index.ts"
import { isIntrinsicTypeName, type IntrinsicTypeName } from "../Workspace/ProjectSnapshot.ts"
import type { EvidenceFact } from "../Evidence.ts"
import type { Criterion, Selection } from "./Query.ts"

/**
 * Admit nodes that resolve to the given canonical symbol, through import
 * aliases and re-exports. Uses the native checker's batched position lookups.
 */
export const resolvesTo = <A extends Node>(
  symbol: NativeSymbol,
  options?: { readonly location?: (candidate: A) => Node },
): Criterion<A, ProjectSnapshotError> => ({
  id: "resolves-to-symbol",
  select: (selections) =>
    Effect.gen(function* () {
      const byProjectFile = Map.groupBy(
        selections.map((selection, index) => ({ selection, index })),
        ({ selection }) => `${selection.project.project.id}:${selection.fileName}`,
      )
      const facts: Array<Readonly<Record<string, EvidenceFact>> | undefined> = Array.from({
        length: selections.length,
      })
      yield* Effect.all(
        [...byProjectFile.values()].map((group) =>
          Effect.gen(function* () {
            const project = group[0]!.selection.project
            const location = options?.location ?? ((candidate: A): Node => candidate)
            const positions = group.map(({ selection }) => {
              const node = location(selection.value)
              return node.getStart(node.getSourceFile())
            })
            const fileName = project.resolveFileName(group[0]!.selection.fileName)
            const symbols = yield* project.symbolsAt(fileName, positions)
            const declarationFile = symbol.valueDeclaration?.path ?? symbol.declarations[0]?.path
            const declarationPath =
              declarationFile === undefined
                ? "unknown"
                : project.containsFileName(String(declarationFile))
                  ? project.relativeFileName(String(declarationFile))
                  : "external"
            yield* Effect.forEach(symbols, (candidate, index) =>
              candidate === undefined
                ? Effect.void
                : Effect.gen(function* () {
                    const canonical = yield* project.canonicalSymbol(candidate)
                    if (canonical === symbol) {
                      facts[group[index]!.index] = {
                        symbol: symbol.name,
                        declarationFile: declarationPath,
                      }
                    }
                  }),
            )
          }),
        ),
        { concurrency: 8 },
      )
      return facts
    }),
})

/**
 * Compute the TypeScript type of each selection's node in order, skipping
 * selections the checker cannot resolve, and collect one optional fact per
 * selection.
 */
const eachComputedType = <A extends Node, Fact>(
  selections: ReadonlyArray<Selection<A>>,
  compute: (
    selection: Selection<A>,
    nodeType: NativeType,
  ) => Effect.Effect<Fact | undefined, ProjectSnapshotError>,
): Effect.Effect<Array<Fact | undefined>, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const byProjectFile = Map.groupBy(
      selections.map((selection, index) => ({ selection, index })),
      ({ selection }) => `${selection.project.project.id}:${selection.fileName}`,
    )
    const facts: Array<Fact | undefined> = Array.from({ length: selections.length })
    yield* Effect.all(
      [...byProjectFile.values()].map((group) =>
        Effect.gen(function* () {
          const project = group[0]!.selection.project
          const positions = group.map(({ selection }) => {
            const node = selection.value
            return node.getStart(node.getSourceFile())
          })
          const types = yield* project.typesAt(group[0]!.selection.fileName, positions)
          yield* Effect.forEach(types, (nodeType, index) => {
            if (nodeType === undefined) return Effect.void
            const { selection, index: selectionIndex } = group[index]!
            return Effect.map(compute(selection, nodeType), (fact) => {
              facts[selectionIndex] = fact
            })
          })
        }),
      ),
      { concurrency: 8 },
    )
    return facts
  })

/** Admit nodes whose computed type is assignable to `target`. */
export const typeAssignableTo = <A extends Node>(
  target: NativeType | IntrinsicTypeName,
): Criterion<A, ProjectSnapshotError> => {
  const targetLabel = isIntrinsicTypeName(target) ? target : "custom-type"
  return {
    id: `type-assignable-to:${targetLabel}`,
    select: (selections) =>
      eachComputedType(selections, (selection, nodeType) =>
        Effect.gen(function* () {
          const expectedType = isIntrinsicTypeName(target)
            ? yield* selection.project.intrinsicType(target)
            : target

          const assignable = yield* selection.project.isTypeAssignableTo(nodeType, expectedType)
          if (!assignable) return undefined

          const typeStr = yield* selection.project.typeToString(nodeType)
          return { type: typeStr, assignableTo: isIntrinsicTypeName(target) ? target : "type" }
        }),
      ),
  }
}
