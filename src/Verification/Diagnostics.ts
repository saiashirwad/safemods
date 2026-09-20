import { Effect } from "effect"
import { DiagnosticCategory, type Diagnostic } from "typescript/unstable/async"
import { nativeRequest } from "../Workspace/NativeRequest.ts"
import { WorkspaceSnapshot } from "../Workspace/index.ts"

export interface DiagnosticRecord {
  readonly code: number
  readonly message: string
  readonly category: "error" | "warning" | "message" | "suggestion"
  readonly fileName: string | undefined
  readonly start: number
  readonly length: number
  readonly line: number
  readonly column: number
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

const record = (diagnostic: Diagnostic, text: string | undefined): DiagnosticRecord => {
  const before = (text ?? "").slice(0, diagnostic.pos)
  return {
    code: diagnostic.code,
    message: diagnostic.text,
    category: categories[diagnostic.category],
    fileName: diagnostic.fileName,
    start: diagnostic.pos,
    length: diagnostic.end - diagnostic.pos,
    line: before.split("\n").length,
    column: before.length - before.lastIndexOf("\n"),
  }
}

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
  const diagnostics: Array<DiagnosticRecord> = []
  for (const project of snapshot.projects) {
    const texts = new Map(
      (yield* project.files).map(({ sourceFile }) => [sourceFile.fileName, sourceFile.text]),
    )
    for (const kind of diagnosticKinds) {
      const found = yield* project.unsafeNative(({ program }) =>
        nativeRequest(kind, () => program[kind]()),
      )
      diagnostics.push(
        ...found.map((diagnostic) => record(diagnostic, texts.get(diagnostic.fileName ?? ""))),
      )
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

const identity = ({ category, code, fileName }: DiagnosticRecord): string =>
  JSON.stringify([category, code, fileName])

export const diffDiagnostics = (
  baseline: ReadonlyArray<DiagnosticRecord>,
  proposed: ReadonlyArray<DiagnosticRecord>,
  moves: ReadonlyMap<string, string> = new Map(),
): DiagnosticDiff => {
  const remaining = Map.groupBy(
    baseline.map((diagnostic) => ({
      ...diagnostic,
      fileName:
        diagnostic.fileName === undefined
          ? undefined
          : (moves.get(diagnostic.fileName) ?? diagnostic.fileName),
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
