import { Effect, Option } from "effect"
import {
  SymbolFlags,
  type Symbol as NativeSymbol,
  type Type as NativeType,
} from "typescript/unstable/async"
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
