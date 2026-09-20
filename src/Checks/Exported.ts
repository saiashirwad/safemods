import { Effect, Option } from "effect"
import type { Node } from "typescript/unstable/ast"
import {
  SymbolFlags,
  type Symbol as NativeSymbol,
  type Type as NativeType,
} from "typescript/unstable/async"
import { matchesGlob } from "node:path"
import * as Query from "../Query.ts"
import type { ProjectFile, ProjectSnapshot, ProjectSnapshotError } from "../Workspace/index.ts"

export const typeOf = (
  project: ProjectSnapshot,
  symbol: NativeSymbol,
): Effect.Effect<NativeType | undefined, ProjectSnapshotError> =>
  (symbol.flags & SymbolFlags.Value) === 0
    ? project.declaredTypeOfSymbol(symbol)
    : project.typeOfSymbol(symbol)

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
    const entries = yield* filesWithin(project, publicApi)
    const exported = yield* Effect.forEach(entries, (file) => project.exportsOf(file), {
      concurrency: "unbounded",
    })
    return new Set(exported.flat().map(({ symbol }) => symbol))
  })
