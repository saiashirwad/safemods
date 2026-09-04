import { createTwoFilesPatch } from "diff"
import type { DiagnosticDiff } from "../Policy/index.ts"
import type { FilePreview, PlanPreview } from "../Verification/index.ts"
import { colorize } from "./Ansi.ts"

const boldRed = ["bold", "red"] as const
const boldGreen = ["bold", "green"] as const
const boldYellow = ["bold", "yellow"] as const
const boldCyan = ["bold", "cyan"] as const

export interface DiffOptions {
  readonly color?: boolean
}

const patchHeaderOptions = {
  includeIndex: false,
  includeUnderline: false,
  includeFileHeaders: true,
} as const

const colorizePatch = (patch: string, enabled: boolean): string => {
  if (!enabled) return patch
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("--- ")) return colorize(line, boldRed)
      if (line.startsWith("+++ ")) return colorize(line, boldGreen)
      if (line.startsWith("@@ ")) return colorize(line, "cyan")
      if (line.startsWith("-")) return colorize(line, "red")
      if (line.startsWith("+")) return colorize(line, "green")
      return line
    })
    .join("\n")
}

const createUnifiedDiff = (
  oldFileName: string,
  newFileName: string,
  beforeText: string,
  afterText: string,
  useColor: boolean,
): string =>
  colorizePatch(
    createTwoFilesPatch(oldFileName, newFileName, beforeText, afterText, undefined, undefined, {
      headerOptions: patchHeaderOptions,
    }),
    useColor,
  )

export const computeUnifiedDiff = (
  fileName: string,
  beforeText: string,
  afterText: string,
  options: DiffOptions = {},
): string => {
  const useColor = options.color ?? true
  if (beforeText === afterText) {
    return colorize(`  ${fileName} (no changes)`, "dim", useColor)
  }
  return createUnifiedDiff(`a/${fileName}`, `b/${fileName}`, beforeText, afterText, useColor)
}

export const renderFilePreview = (file: FilePreview, options: DiffOptions = {}): string => {
  const useColor = options.color ?? true
  const badge =
    file.action === "create"
      ? colorize("[CREATE]", boldGreen, useColor)
      : file.action === "delete"
        ? colorize("[DELETE]", boldRed, useColor)
        : file.action === "move"
          ? colorize("[MOVE]", boldYellow, useColor)
          : colorize("[MODIFY]", boldCyan, useColor)

  const header = `${badge} ${colorize(file.fileName, "bold", useColor)} (${file.projectId})`
  const beforeText = file.before.exists ? file.before.text : ""
  const afterText = file.after.exists ? file.after.text : ""
  const diff =
    beforeText === afterText
      ? colorize(`  ${file.fileName} (no changes)`, "dim", useColor)
      : createUnifiedDiff(
          file.before.exists ? `a/${file.fileName}` : "/dev/null",
          file.after.exists ? `b/${file.fileName}` : "/dev/null",
          beforeText,
          afterText,
          useColor,
        )
  return `${header}\n${diff}`
}

export const renderPlanPreview = (preview: PlanPreview, options: DiffOptions = {}): string => {
  const useColor = options.color ?? true
  const lines: Array<string> = []

  lines.push(
    colorize(`Transformation Plan Preview [${preview.planId.slice(0, 8)}]`, "bold", useColor),
  )
  lines.push(colorize(`Total files affected: ${preview.files.length}`, "dim", useColor))
  lines.push("")

  for (const file of preview.files) {
    lines.push(renderFilePreview(file, options))
    lines.push("")
  }

  return lines.join("\n")
}

/** Render diagnostic delta verification summary. */
export const renderDiagnosticDiff = (diff: DiagnosticDiff, options: DiffOptions = {}): string => {
  const useColor = options.color ?? true
  const lines: Array<string> = []

  const total = diff.introduced.length + diff.resolved.length + diff.unchanged.length
  lines.push(colorize(`Diagnostic Verification (${total} total)`, "bold", useColor))

  if (diff.resolved.length > 0) {
    lines.push(colorize(`  ✔ Resolved ${diff.resolved.length} diagnostic(s):`, "green", useColor))
    for (const d of diff.resolved) {
      lines.push(
        colorize(`    - TS${d.code}: ${d.message} (${d.fileName}:${d.start})`, "green", useColor),
      )
    }
  }

  if (diff.introduced.length > 0) {
    lines.push(
      colorize(`  ✖ Introduced ${diff.introduced.length} new diagnostic(s):`, "red", useColor),
    )
    for (const d of diff.introduced) {
      lines.push(
        colorize(`    + TS${d.code}: ${d.message} (${d.fileName}:${d.start})`, "red", useColor),
      )
    }
  } else {
    lines.push(colorize(`  ✔ No new diagnostic errors introduced`, "green", useColor))
  }

  return lines.join("\n")
}
