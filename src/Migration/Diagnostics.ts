import { Effect, FileSystem } from "effect"
import { DiagnosticCategory, type Diagnostic } from "typescript/unstable/async"
import type * as Finding from "../Finding.ts"
import * as Position from "../Position.ts"
import type * as ProjectId from "../ProjectId.ts"
import { nativeRequest } from "../Workspace/NativeRequest.ts"
import { Workspace, type WorkspaceSnapshot } from "../Workspace/index.ts"

export interface DiagnosticRecord extends Omit<Finding.Located, "fileName"> {
  readonly projectId: ProjectId.Type
  readonly fileName: string | undefined
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
  projectId: ProjectId.Type,
  fileName: string | undefined,
  text: string,
): DiagnosticRecord => ({
  projectId,
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

const sameDiagnostic = (left: DiagnosticRecord, right: DiagnosticRecord): boolean =>
  left.projectId === right.projectId && left.fileName === right.fileName &&
  left.category === right.category &&
  left.code === right.code && left.message === right.message

const locationKey = (diagnostic: DiagnosticRecord): string =>
  JSON.stringify([diagnostic.projectId, diagnostic.fileName])

export const collectDiagnostics = (snapshot: WorkspaceSnapshot) =>
  Effect.gen(function* () {
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
            (workspace.relativePath(absolute) ?? absolute)
          diagnostics.push(record(diagnostic, project.project.id, fileName, text))
        }
      }
    }
    const byFile = new Map<string, Array<DiagnosticRecord>>()
    return diagnostics.filter((diagnostic) => {
      const key = locationKey(diagnostic)
      const matches = byFile.get(key)
      if (
        matches?.some((other) =>
          other.start === diagnostic.start && sameDiagnostic(other, diagnostic)
        )
      ) return false
      if (matches === undefined) byFile.set(key, [diagnostic])
      else matches.push(diagnostic)
      return true
    })
  })

export const diffDiagnostics = (
  baseline: ReadonlyArray<DiagnosticRecord>,
  proposed: ReadonlyArray<DiagnosticRecord>,
  moves: ReadonlyMap<string, string> = new Map(),
): DiagnosticDiff => {
  const remaining = Map.groupBy(
    baseline.map((diagnostic) => ({
      ...diagnostic,
      fileName: diagnostic.fileName === undefined ?
        undefined :
        (moves.get(diagnostic.fileName) ?? diagnostic.fileName),
    })),
    locationKey,
  )
  const introduced: Array<DiagnosticRecord> = []
  const unchanged: Array<DiagnosticRecord> = []
  for (const diagnostic of proposed) {
    const matches = remaining.get(locationKey(diagnostic))
    const index = matches?.findIndex((other) => sameDiagnostic(other, diagnostic)) ?? -1
    if (matches === undefined || index < 0) introduced.push(diagnostic)
    else {
      matches.splice(index, 1)
      unchanged.push(diagnostic)
    }
  }
  return { introduced, unchanged, resolved: [...remaining.values()].flat() }
}
