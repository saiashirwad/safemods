import { Data, Effect } from "effect"
import { firstConflict, type TextEdit } from "./Edit.ts"
import * as FileRef from "./FileRef.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"

export type { TextEdit } from "./Edit.ts"

export type FileOperation =
  | (FileRef.FileRef & { readonly kind: "create"; readonly content: string })
  | (FileRef.FileRef & { readonly kind: "delete" })
  | (FileRef.FileRef & { readonly kind: "move"; readonly toFileName: ProjectRelativePath.Type })

export interface UnsupportedFinding extends FileRef.FileRef {
  readonly start: number
  readonly end: number
  readonly reason: string
}

export interface PlanPolicies {
  readonly maxAffectedFiles?: number
  readonly diagnostics: "no-new-errors" | "allow-new-errors"
  readonly idempotence: "required" | "not-promised"
}

export interface Plan {
  readonly edits: ReadonlyArray<TextEdit>
  readonly fileOperations: ReadonlyArray<FileOperation>
  readonly unsupported: ReadonlyArray<UnsupportedFinding>
}

export type Contents = FileRef.ReadonlyMap<Uint8Array | undefined>

export class InvalidPlan extends Data.TaggedError("InvalidPlan")<{ readonly detail: string }> {}

export const targetOf = (operation: FileOperation): FileRef.FileRef =>
  operation.kind === "move" ?
    { projectId: operation.projectId, fileName: operation.toFileName } :
    operation

const problem = (plan: Plan, before: Contents): string | undefined => {
  const stateOf = (file: FileRef.FileRef): "file" | "missing" | undefined => {
    const bytes = before.get(file.projectId)
    if (bytes === undefined || !bytes.has(file.fileName)) return undefined
    return bytes.get(file.fileName) === undefined ? "missing" : "file"
  }

  if (firstConflict(plan.edits) !== undefined) return "Overlapping edits"
  const edited = new Set<string>()
  for (const edit of plan.edits) {
    if (stateOf(edit) !== "file") return `Missing source ${edit.fileName}`
    edited.add(FileRef.key(edit))
  }

  const operated = new Set<string>()
  for (const operation of plan.fileOperations) {
    const from = FileRef.key(operation)
    const touched = [from]
    if (operation.kind === "create") {
      if (stateOf(operation) !== "missing") {
        return `Create needs an absent path: ${operation.fileName}`
      }
    } else if (stateOf(operation) !== "file") {
      return `Missing source ${operation.fileName}`
    }
    if (operation.kind === "move") {
      if (stateOf(targetOf(operation)) !== "missing") {
        return `Move needs an absent target: ${operation.toFileName}`
      }
      touched.push(FileRef.key(targetOf(operation)))
    } else if (edited.has(from)) {
      return `Edit conflicts with ${operation.kind} of ${operation.fileName}`
    }
    for (const key of touched) {
      if (operated.has(key)) return `Conflicting file operations on ${operation.fileName}`
      operated.add(key)
    }
  }
  return undefined
}

export const validate = (plan: Plan, before: Contents): Effect.Effect<void, InvalidPlan> => {
  const detail = problem(plan, before)
  return detail === undefined ? Effect.void : Effect.fail(new InvalidPlan({ detail }))
}
