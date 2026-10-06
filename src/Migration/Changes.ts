import { Data, Effect } from "effect"
import { firstConflict } from "../Edit.ts"
import type * as WorkspacePath from "../WorkspacePath.ts"

import type { FileOperation, Proposal } from "../Proposal.ts"

export type Contents = ReadonlyMap<WorkspacePath.Type, Uint8Array | undefined>

export class InvalidProposal
  extends Data.TaggedError("InvalidProposal")<{ readonly detail: string }>
{}

export const targetOf = (operation: FileOperation): WorkspacePath.Type =>
  operation.kind === "move" ? operation.toFileName : operation.fileName

const distinctBy = <A extends { readonly fileName: WorkspacePath.Type }>(
  values: ReadonlyArray<A>,
  same: (left: A, right: A) => boolean,
): ReadonlyArray<A> => {
  const seen = new Map<WorkspacePath.Type, Array<A>>()
  return values.filter((value) => {
    const matches = seen.get(value.fileName)
    if (matches?.some((other) => same(other, value))) return false
    if (matches === undefined) seen.set(value.fileName, [value])
    else matches.push(value)
    return true
  })
}

const sameOperation = (left: FileOperation, right: FileOperation): boolean => {
  if (left.kind !== right.kind || left.fileName !== right.fileName) return false
  if (left.kind === "create") return right.kind === "create" && left.content === right.content
  if (left.kind === "move") return right.kind === "move" && left.toFileName === right.toFileName
  return true
}

export const distinct = (plan: Proposal): Proposal => ({
  edits: distinctBy(
    plan.edits,
    (left, right) =>
      left.start === right.start && left.end === right.end &&
      left.expectedTextHash === right.expectedTextHash && left.newText === right.newText,
  ),
  fileOperations: distinctBy(plan.fileOperations, sameOperation),
  unsupported: distinctBy(
    plan.unsupported,
    (left, right) =>
      left.start === right.start && left.end === right.end && left.message === right.message,
  ),
})

const problem = (plan: Proposal, before: Contents): string | undefined => {
  const stateOf = (fileName: WorkspacePath.Type): "file" | "missing" | undefined =>
    !before.has(fileName) ? undefined : before.get(fileName) === undefined ? "missing" : "file"

  for (const edit of plan.edits) {
    if (
      !Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) || edit.start < 0 ||
      edit.end < edit.start
    ) return `Invalid edit range in ${edit.fileName}`
  }
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

export const validate = (
  plan: Proposal,
  before: Contents,
): Effect.Effect<void, InvalidProposal> => {
  const detail = problem(plan, before)
  return detail === undefined ? Effect.void : new InvalidProposal({ detail })
}
