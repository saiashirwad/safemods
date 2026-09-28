import { Data, Effect } from "effect"
import { firstConflict, type TextEdit } from "./Edit.ts"
import type { Finding } from "./Finding.ts"
import type * as WorkspacePath from "./WorkspacePath.ts"

export type { TextEdit } from "./Edit.ts"

export type FileOperation =
  | { readonly kind: "create"; readonly fileName: WorkspacePath.Type; readonly content: string }
  | { readonly kind: "delete"; readonly fileName: WorkspacePath.Type }
  | {
    readonly kind: "move"
    readonly fileName: WorkspacePath.Type
    readonly toFileName: WorkspacePath.Type
  }

export interface PlanPolicies {
  readonly maxAffectedFiles?: number
  readonly diagnostics: "no-new-errors" | "allow-new-errors"
  readonly idempotence: "required" | "not-promised"
}

export interface Plan {
  readonly edits: ReadonlyArray<TextEdit>
  readonly fileOperations: ReadonlyArray<FileOperation>
  readonly unsupported: ReadonlyArray<Finding>
}

export type Contents = ReadonlyMap<WorkspacePath.Type, Uint8Array | undefined>

export class InvalidPlan extends Data.TaggedError("InvalidPlan")<{ readonly detail: string }> {}

export const targetOf = (operation: FileOperation): WorkspacePath.Type =>
  operation.kind === "move" ? operation.toFileName : operation.fileName

const distinctBy = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => [
  ...new Map(values.map((value) => [JSON.stringify(value), value])).values(),
]

export const distinct = (plan: Plan): Plan => ({
  edits: distinctBy(plan.edits),
  fileOperations: distinctBy(plan.fileOperations),
  unsupported: distinctBy(plan.unsupported),
})

const problem = (plan: Plan, before: Contents): string | undefined => {
  const stateOf = (fileName: WorkspacePath.Type): "file" | "missing" | undefined =>
    !before.has(fileName) ? undefined : before.get(fileName) === undefined ? "missing" : "file"

  if (firstConflict(plan.edits) !== undefined) return "Overlapping edits"
  const edited = new Set<string>()
  for (const edit of plan.edits) {
    if (stateOf(edit.fileName) !== "file") return `Missing source ${edit.fileName}`
    edited.add(edit.fileName)
  }

  const operated = new Set<string>()
  for (const operation of plan.fileOperations) {
    const touched = [operation.fileName]
    if (operation.kind === "create") {
      if (stateOf(operation.fileName) !== "missing") {
        return `Create needs an absent path: ${operation.fileName}`
      }
    } else if (stateOf(operation.fileName) !== "file") {
      return `Missing source ${operation.fileName}`
    }
    if (operation.kind === "move") {
      if (stateOf(operation.toFileName) !== "missing") {
        return `Move needs an absent target: ${operation.toFileName}`
      }
      touched.push(operation.toFileName)
    } else if (edited.has(operation.fileName)) {
      return `Edit conflicts with ${operation.kind} of ${operation.fileName}`
    }
    for (const fileName of touched) {
      if (operated.has(fileName)) return `Conflicting file operations on ${operation.fileName}`
      operated.add(fileName)
    }
  }
  return undefined
}

export const validate = (plan: Plan, before: Contents): Effect.Effect<void, InvalidPlan> => {
  const detail = problem(plan, before)
  return detail === undefined ? Effect.void : new InvalidPlan({ detail })
}
