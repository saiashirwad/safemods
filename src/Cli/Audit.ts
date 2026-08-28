/**
 * Safemods CLI — read-only search and audit reporting.
 */
import { Data, Effect, Option, Schema } from "effect"
import type { Json } from "../Evidence/index.ts"
import type { TransformationPlan } from "../Plan/index.ts"
import { virtualFileKey } from "../VirtualFs/index.ts"
import type {
  ProjectNotInSnapshot,
  ProjectSnapshot,
  ProjectSnapshotError,
  WorkspaceSnapshotService,
} from "../Workspace/index.ts"
import { colorize } from "./Ansi.ts"

const boldCyan = ["bold", "cyan"] as const

export interface AuditCriterionRecord {
  readonly criterion: string
  readonly facts: Readonly<Record<string, Json>>
}

export interface AuditFinding {
  readonly id: string
  readonly projectId: string
  readonly fileName: string
  readonly start: number
  readonly end: number
  readonly startLine: number
  readonly startColumn: number
  readonly endLine: number
  readonly endColumn: number
  readonly snippet?: string | undefined
  readonly criteria: ReadonlyArray<AuditCriterionRecord>
}

export interface AuditReport {
  readonly recipe: {
    readonly name: string
    readonly version: string
  }
  readonly totalMatches: number
  readonly totalFiles: number
  readonly findings: ReadonlyArray<AuditFinding>
}

export class CliMatchFoundError extends Data.TaggedError("CliMatchFoundError")<{
  readonly matches: number
  readonly files: number
}> {}

const AuditCriterionSchema = Schema.Struct({
  criterion: Schema.String,
  facts: Schema.Record(Schema.String, Schema.Json),
})
const OffsetSchema = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const SelectionEvidenceSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("selection"),
  facts: Schema.Struct({
    projectId: Schema.String,
    fileName: Schema.String,
    start: OffsetSchema,
    end: OffsetSchema,
    criteria: Schema.Array(AuditCriterionSchema),
  }),
})

const decodeSelectionEvidence = Schema.decodeUnknownOption(SelectionEvidenceSchema)

/** Build structured AuditReport from a transformation plan and workspace snapshot. */
export const buildAuditReport = (
  plan: TransformationPlan,
  snapshot: WorkspaceSnapshotService,
): Effect.Effect<AuditReport, ProjectSnapshotError | ProjectNotInSnapshot> =>
  Effect.gen(function* () {
    const findings: Array<AuditFinding> = []
    const projectCache = new Map<string, ProjectSnapshot>()

    for (const record of plan.evidence) {
      const decoded = decodeSelectionEvidence(record)
      if (Option.isNone(decoded)) continue

      const { id, facts } = decoded.value
      const { projectId, fileName, start, end } = facts

      let project = projectCache.get(projectId)
      if (!project) {
        const config = snapshot.projects.find((candidate) => candidate.id === projectId)
        if (config) {
          project = yield* snapshot.project(config)
          projectCache.set(projectId, project)
        }
      }

      const sourceFile = project ? yield* project.sourceFile(fileName) : undefined
      const sourceText = sourceFile?.text ?? ""
      const position = (offset: number) => {
        if (sourceFile === undefined) return { line: 1, column: 1 }
        const clamped = Math.max(0, Math.min(offset, sourceText.length))
        const location = sourceFile.getLineAndCharacterOfPosition(clamped)
        return { line: location.line + 1, column: location.character + 1 }
      }
      const startLoc = position(start)
      const endLoc = position(end)
      const snippet = sourceFile === undefined ? undefined : sourceText.slice(start, end)

      findings.push({
        id,
        projectId,
        fileName,
        start,
        end,
        startLine: startLoc.line,
        startColumn: startLoc.column,
        endLine: endLoc.line,
        endColumn: endLoc.column,
        snippet,
        criteria: facts.criteria,
      })
    }

    findings.sort((a, b) => {
      const cmpProject = a.projectId.localeCompare(b.projectId)
      if (cmpProject !== 0) return cmpProject
      const cmpFile = a.fileName.localeCompare(b.fileName)
      if (cmpFile !== 0) return cmpFile
      if (a.start !== b.start) return a.start - b.start
      if (a.end !== b.end) return a.end - b.end
      return a.id.localeCompare(b.id)
    })

    const uniqueFiles = new Set(
      findings.map((finding) => virtualFileKey(finding.projectId, finding.fileName)),
    )

    return {
      recipe: {
        name: plan.recipe.name,
        version: plan.recipe.version,
      },
      totalMatches: findings.length,
      totalFiles: uniqueFiles.size,
      findings,
    }
  })

/** Format AuditReport as Human-readable terminal text. */
export const renderAuditText = (
  report: AuditReport,
  options: { readonly color?: boolean } = {},
): string => {
  const useColor = options.color ?? true
  const lines: Array<string> = []

  lines.push(
    colorize(`Audit Report: ${report.recipe.name} [v${report.recipe.version}]`, "bold", useColor),
  )
  lines.push(
    colorize(
      `Found ${report.totalMatches} match(es) across ${report.totalFiles} file(s)`,
      "dim",
      useColor,
    ),
  )
  lines.push("")

  if (report.findings.length === 0) {
    lines.push(colorize("✔ No matches found.", "green", useColor))
    return lines.join("\n")
  }

  const grouped = new Map<string, Array<AuditFinding>>()
  for (const f of report.findings) {
    const key = `${f.projectId}:${f.fileName}`
    const existing = grouped.get(key)
    if (existing) {
      existing.push(f)
    } else {
      grouped.set(key, [f])
    }
  }

  for (const [fileKey, fileFindings] of grouped) {
    lines.push(colorize(`📄 ${fileKey}`, boldCyan, useColor))
    for (const f of fileFindings) {
      const location = colorize(`  line ${f.startLine}:${f.startColumn}`, "yellow", useColor)
      const criteriaStr =
        f.criteria.length > 0
          ? colorize(` [${f.criteria.map((c) => c.criterion).join(", ")}]`, "dim", useColor)
          : ""
      lines.push(`${location}${criteriaStr}`)
      if (f.snippet) {
        const snippetLines = f.snippet.split("\n")
        const truncated = snippetLines
          .slice(0, 3)
          .map((l) => `    ${l.trim()}`)
          .join("\n")
        lines.push(colorize(truncated, "gray", useColor))
      }
    }
    lines.push("")
  }

  return lines.join("\n")
}
