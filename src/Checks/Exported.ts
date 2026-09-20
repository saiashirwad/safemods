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
    const visited = new Set<string>()
    let files = yield* filesWithin(project, publicApi)
    while (files.length > 0) {
      for (const file of files) visited.add(file.fileName)
      const exported = (yield* Effect.forEach(files, (file) => project.exportsOf(file), {
        concurrency: "unbounded",
      })).flat()
      for (const { symbol } of exported) published.add(symbol)
      const namespaces = exported.filter(
        ({ symbol }) => (symbol.flags & SymbolFlags.ValueModule) !== 0,
      )
      const sites = (yield* Effect.forEach(namespaces, ({ symbol }) => project.declaredIn(symbol), {
        concurrency: "unbounded",
      })).flat()
      const reached = [
        ...new Set(sites.flatMap(({ fileName }) => (fileName === undefined ? [] : [fileName]))),
      ]
      files = (yield* Effect.forEach(
        reached.filter((fileName) => !visited.has(fileName)),
        (fileName) => project.file(fileName),
      )).filter((file) => file !== undefined)
    }
    return published
  })
