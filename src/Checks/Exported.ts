import { Effect, Option } from "effect"
import type { Node } from "typescript/unstable/ast"
import { SymbolFlags, type Symbol as NativeSymbol } from "typescript/unstable/async"
import { matchesGlob } from "node:path"
import * as Query from "../Query.ts"
import type { ProjectFile, ProjectSnapshot } from "../Workspace/index.ts"

export const declarationIn = (project: ProjectSnapshot, symbol: NativeSymbol, file: ProjectFile) =>
  Effect.map(project.declarationsOf(symbol), (declarations) =>
    declarations
      .flatMap((declaration) => Option.toArray(Query.selectionOf(project, declaration)))
      .find((selection) => selection.fileName === file.fileName),
  )

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "kind" in value && "getSourceFile" in value

export const nameOf = (declaration: Node): Node | undefined =>
  "name" in declaration && isNode(declaration.name) ? declaration.name : undefined

export const filesWithin = (project: ProjectSnapshot, patterns: ReadonlyArray<string>) =>
  Effect.map(project.files, (files) =>
    files.filter((file) => patterns.some((pattern) => matchesGlob(file.fileName, pattern))),
  )

export const publicSymbols = (project: ProjectSnapshot, publicApi: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const published = new Set<NativeSymbol>()
    const files = yield* filesWithin(project, publicApi)
    let exported = (yield* Effect.forEach(files, (file) => project.exportsOf(file), {
      concurrency: "unbounded",
    })).flat()
    while (exported.length > 0) {
      const namespaces: Array<NativeSymbol> = []
      for (const { symbol } of exported) {
        if (published.has(symbol)) continue
        published.add(symbol)
        if ((symbol.flags & SymbolFlags.Module) !== 0) namespaces.push(symbol)
      }
      exported = (yield* Effect.forEach(namespaces, (symbol) => project.exportsOf(symbol), {
        concurrency: "unbounded",
      })).flat()
    }
    return published
  })
