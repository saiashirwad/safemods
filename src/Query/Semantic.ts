/** TypeScript semantic and declaration criteria. */
import { Effect } from "effect"
import type { Node } from "typescript/unstable/ast"
import type { Symbol as NativeSymbol, Type as NativeType } from "typescript/unstable/async"
import type { ProjectSnapshotError } from "../Workspace/index.ts"
import { isIntrinsicTypeName, type IntrinsicTypeName } from "../Workspace/ProjectSnapshot.ts"
import type { EvidenceFact } from "../Evidence.ts"
import type { Criterion } from "./Query.ts"

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
            const fileName = group[0]!.selection.fileName
            const symbols = yield* project.symbolsAt(fileName, positions)
            const declarationFile = symbol.valueDeclaration?.path ?? symbol.declarations[0]?.path
            const declarationPath =
              declarationFile === undefined
                ? "unknown"
                : String(declarationFile) === group[0]!.selection.value.getSourceFile().fileName
                  ? fileName
                  : "external"
            for (let index = 0; index < symbols.length; index++) {
              const candidate = symbols[index]
              if (candidate === undefined) continue
              const canonical = yield* project.canonicalSymbol(candidate)
              if (canonical === symbol) {
                facts[group[index]!.index] = {
                  symbol: symbol.name,
                  declarationFile: declarationPath,
                }
              }
            }
          }),
        ),
        { concurrency: 8 },
      )
      return facts
    }),
})

/** Admit nodes whose computed type is assignable to `target`. */
export const typeAssignableTo = <A extends Node>(
  target: NativeType | IntrinsicTypeName,
): Criterion<A, ProjectSnapshotError> => {
  const targetLabel = isIntrinsicTypeName(target) ? target : "custom-type"
  return {
    id: `type-assignable-to:${targetLabel}`,
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
              const positions = group.map(({ selection }) => {
                const node = selection.value
                return node.getStart(node.getSourceFile())
              })
              const types = yield* project.typesAt(group[0]!.selection.fileName, positions)
              const expectedType = isIntrinsicTypeName(target)
                ? yield* project.intrinsicType(target)
                : target
              for (let index = 0; index < types.length; index++) {
                const nodeType = types[index]
                if (nodeType === undefined) continue
                const { index: selectionIndex } = group[index]!
                if (!(yield* project.isTypeAssignableTo(nodeType, expectedType))) continue
                facts[selectionIndex] = {
                  type: yield* project.typeToString(nodeType),
                  assignableTo: isIntrinsicTypeName(target) ? target : "type",
                }
              }
            }),
          ),
          { concurrency: 8 },
        )
        return facts
      }),
  }
}
