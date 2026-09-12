/** Compiler diagnostic collection and normalization. */
import { Effect } from "effect"
import { DiagnosticCategory, type Diagnostic } from "typescript/unstable/async"
import { WorkspaceSnapshot } from "../Workspace/index.ts"
import { nativeRequest } from "../Workspace/NativeRequest.ts"

export interface DiagnosticRecord {
  readonly code: number | string
  readonly message: string
  readonly category: "error" | "warning" | "message" | "suggestion"
  readonly fileName?: string | undefined
  readonly start?: number | undefined
  readonly length?: number | undefined
}

export interface DiagnosticDiff {
  readonly introduced: ReadonlyArray<DiagnosticRecord>
  readonly resolved: ReadonlyArray<DiagnosticRecord>
  readonly unchanged: ReadonlyArray<DiagnosticRecord>
}

const normalizeDiagnostic = (diagnostic: Diagnostic): DiagnosticRecord => ({
  code: diagnostic.code,
  message: diagnostic.text,
  category:
    diagnostic.category === DiagnosticCategory.Warning
      ? "warning"
      : diagnostic.category === DiagnosticCategory.Suggestion
        ? "suggestion"
        : diagnostic.category === DiagnosticCategory.Message
          ? "message"
          : "error",
  fileName: diagnostic.fileName,
  start: diagnostic.pos,
  length: diagnostic.end - diagnostic.pos,
})

const collectProjectDiagnostics = (nativeProject: {
  readonly program: {
    readonly getSyntacticDiagnostics: () => PromiseLike<ReadonlyArray<Diagnostic>>
    readonly getBindDiagnostics: () => PromiseLike<ReadonlyArray<Diagnostic>>
    readonly getSemanticDiagnostics: () => PromiseLike<ReadonlyArray<Diagnostic>>
    readonly getProgramDiagnostics: () => PromiseLike<ReadonlyArray<Diagnostic>>
    readonly getGlobalDiagnostics: () => PromiseLike<ReadonlyArray<Diagnostic>>
    readonly getConfigFileParsingDiagnostics: () => PromiseLike<ReadonlyArray<Diagnostic>>
  }
}) =>
  Effect.all([
    nativeRequest("getSyntacticDiagnostics", () => nativeProject.program.getSyntacticDiagnostics()),
    nativeRequest("getBindDiagnostics", () => nativeProject.program.getBindDiagnostics()),
    nativeRequest("getSemanticDiagnostics", () => nativeProject.program.getSemanticDiagnostics()),
    nativeRequest("getProgramDiagnostics", () => nativeProject.program.getProgramDiagnostics()),
    nativeRequest("getGlobalDiagnostics", () => nativeProject.program.getGlobalDiagnostics()),
    nativeRequest("getConfigFileParsingDiagnostics", () =>
      nativeProject.program.getConfigFileParsingDiagnostics(),
    ),
  ])

export const collectDiagnostics = Effect.gen(function* () {
  const snapshot = yield* WorkspaceSnapshot
  const allDiagnostics: Array<DiagnosticRecord> = []
  const seen = new Set<string>()

  for (const configured of snapshot.projects) {
    const project = yield* snapshot.project(configured)
    const lists = yield* project.unsafeNative((nativeProject) =>
      collectProjectDiagnostics(nativeProject),
    )
    for (const list of lists) {
      for (const diagnostic of list) {
        const record = normalizeDiagnostic(diagnostic)
        const key = JSON.stringify([
          record.category,
          record.code,
          record.fileName ?? null,
          record.start ?? null,
          record.length ?? null,
          record.message,
        ])
        if (seen.has(key)) continue
        seen.add(key)
        allDiagnostics.push(record)
      }
    }
  }
  return allDiagnostics
})
