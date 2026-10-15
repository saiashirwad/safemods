import { matchesGlob } from "node:path"
import { Effect } from "effect"
import { type Symbol as NativeSymbol, SymbolFlags } from "typescript/unstable/async"
import type { ProjectFile, ProjectSnapshot, ProjectSnapshotError } from "../Workspace/index.ts"

export const isWithin = (fileName: string, pattern: string): boolean =>
  matchesGlob(fileName, pattern.replaceAll("\\", "/"))

export const files = (
  project: ProjectSnapshot,
  patterns: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<ProjectFile>, ProjectSnapshotError> =>
  Effect.map(
    project.files,
    (all) => all.filter((file) => patterns.some((pattern) => isWithin(file.fileName, pattern))),
  )

export const publicSymbols = (
  project: ProjectSnapshot,
  patterns: ReadonlyArray<string>,
): Effect.Effect<ReadonlySet<NativeSymbol>, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const published = new Set<NativeSymbol>()
    const exportsOf = (modules: ReadonlyArray<ProjectFile | NativeSymbol>) =>
      Effect.map(
        Effect.forEach(modules, (module) => project.exportsOf(module), {
          concurrency: "unbounded",
        }),
        (exported) => exported.flat(),
      )
    let exported = yield* exportsOf(yield* files(project, patterns))
    while (exported.length > 0) {
      const namespaces: Array<NativeSymbol> = []
      for (const { symbol } of exported) {
        if (published.has(symbol)) continue
        published.add(symbol)
        if ((symbol.flags & SymbolFlags.Module) !== 0) namespaces.push(symbol)
      }
      exported = yield* exportsOf(namespaces)
    }
    return published
  })
