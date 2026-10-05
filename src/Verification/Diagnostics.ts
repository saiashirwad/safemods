import { Effect, FileSystem } from "effect"
import { DiagnosticCategory, type Diagnostic } from "typescript/unstable/async"
import type * as Finding from "../Finding.ts"
import * as Position from "../Position.ts"
import { nativeRequest } from "../Workspace/NativeRequest.ts"
import { Workspace, WorkspaceSnapshot } from "../Workspace/index.ts"
import type * as WorkspacePath from "../WorkspacePath.ts"

export interface DiagnosticRecord extends Omit<Finding.Located, "fileName"> {
  readonly fileName: WorkspacePath.Type | undefined
  readonly code: number
  readonly category: "error" | "warning" | "message" | "suggestion"
}

export interface DiagnosticDiff {
  readonly introduced: ReadonlyArray<DiagnosticRecord>
  readonly resolved: ReadonlyArray<DiagnosticRecord>
  readonly unchanged: ReadonlyArray<DiagnosticRecord>
}

const categories = {
  [DiagnosticCategory.Error]: "error",
  [DiagnosticCategory.Warning]: "warning",
  [DiagnosticCategory.Message]: "message",
  [DiagnosticCategory.Suggestion]: "suggestion",
} as const

const record = (
  diagnostic: Diagnostic,
  fileName: WorkspacePath.Type | undefined,
  text: string,
): DiagnosticRecord => ({
  fileName,
  start: diagnostic.pos,
  end: diagnostic.end,
  message: diagnostic.text,
  code: diagnostic.code,
  category: categories[diagnostic.category],
  ...Position.at(text, diagnostic.pos),
})

const diagnosticKinds = [
  "getConfigFileParsingDiagnostics",
  "getGlobalDiagnostics",
  "getProgramDiagnostics",
  "getSyntacticDiagnostics",
  "getBindDiagnostics",
  "getSemanticDiagnostics",
] as const

export const collectDiagnostics = Effect.gen(function* () {
  const snapshot = yield* WorkspaceSnapshot
  const fs = yield* FileSystem.FileSystem
  const workspace = yield* Workspace
  const diagnostics: Array<DiagnosticRecord> = []
  for (const project of snapshot.projects) {
    const texts = new Map(
      (yield* project.files).map(({ sourceFile }) => [sourceFile.fileName, sourceFile.text]),
    )
    for (const kind of diagnosticKinds) {
      const found = yield* project.unsafeNative(({ program }) =>
        nativeRequest(kind, () => program[kind]())
      )
      for (const diagnostic of found) {
        const absolute = diagnostic.fileName ?? ""
        const text = texts.get(absolute) ??
          (yield* fs.readFileString(absolute).pipe(Effect.orElseSucceed(() => "")))
        const fileName = diagnostic.fileName === undefined ?
          undefined :
          workspace.relativePath(absolute)
        diagnostics.push(record(diagnostic, fileName, text))
      }
    }
  }
  return [
    ...new Map(
      diagnostics.map((diagnostic) => [
        JSON.stringify([
          diagnostic.fileName,
          diagnostic.start,
          diagnostic.code,
          diagnostic.message,
        ]),
        diagnostic,
      ]),
    ).values(),
  ]
})

const identity = ({ category, code, fileName, message }: DiagnosticRecord): string =>
  JSON.stringify([category, code, fileName, message])

export const diffDiagnostics = (
  baseline: ReadonlyArray<DiagnosticRecord>,
  proposed: ReadonlyArray<DiagnosticRecord>,
  moves: ReadonlyMap<WorkspacePath.Type, WorkspacePath.Type> = new Map(),
): DiagnosticDiff => {
  const remaining = Map.groupBy(
    baseline.map((diagnostic) => ({
      ...diagnostic,
      fileName: diagnostic.fileName === undefined ?
        undefined :
        (moves.get(diagnostic.fileName) ?? diagnostic.fileName),
    })),
    identity,
  )
  const introduced: Array<DiagnosticRecord> = []
  const unchanged: Array<DiagnosticRecord> = []
  for (const diagnostic of proposed) {
    const matched = remaining.get(identity(diagnostic))?.pop()
    if (matched === undefined) introduced.push(diagnostic)
    else unchanged.push(diagnostic)
  }
  return { introduced, unchanged, resolved: [...remaining.values()].flat() }
}
