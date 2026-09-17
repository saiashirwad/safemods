import { Predicate } from "effect"
import type { Node } from "typescript/unstable/ast"
import { textEdit, type TextEdit } from "./Edit.ts"
import { canonicalJson, type EvidenceRecord, type FileOperation } from "./Plan.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"
import type { Selection } from "./Query.ts"
import * as Sha256 from "./Sha256.ts"
import type { ProjectFile, ProjectSnapshot } from "./Workspace/index.ts"

export interface Draft {
  readonly edits: ReadonlyArray<TextEdit>
  readonly fileOperations: ReadonlyArray<FileOperation>
  readonly evidence: ReadonlyArray<EvidenceRecord>
  readonly matches: number
}

export type Replacement = string | { readonly node: Node; readonly text: string }

export const empty: Draft = { edits: [], fileOperations: [], evidence: [], matches: 0 }

export const concat = (...drafts: ReadonlyArray<Draft>): Draft => ({
  edits: drafts.flatMap((draft) => draft.edits),
  fileOperations: drafts.flatMap((draft) => draft.fileOperations),
  evidence: [
    ...new Map(
      drafts.flatMap((draft) => draft.evidence).map((record) => [canonicalJson(record), record]),
    ).values(),
  ],
  matches: drafts.reduce((total, draft) => total + draft.matches, 0),
})

const editBetween = (
  project: ProjectSnapshot,
  node: Node,
  range: "node" | "before" | "after",
  newText: string,
): TextEdit => {
  const sourceFile = node.getSourceFile()
  const start = range === "after" ? node.getEnd() : node.getStart(sourceFile)
  const end = range === "before" ? start : node.getEnd()
  return textEdit({
    projectId: project.project.id,
    fileName: project.fileNameOf(sourceFile),
    sourceText: sourceFile.text,
    start,
    end,
    newText,
  })
}

const oneEdit = (edit: TextEdit): Draft => ({ ...empty, edits: [edit], matches: 1 })

const oneOperation = (operation: FileOperation): Draft => ({
  ...empty,
  fileOperations: [operation],
  matches: 1,
})

export const replace = (project: ProjectSnapshot, node: Node, newText: string): Draft =>
  oneEdit(editBetween(project, node, "node", newText))

export const remove = (project: ProjectSnapshot, node: Node): Draft => replace(project, node, "")

export const insertBefore = (project: ProjectSnapshot, node: Node, text: string): Draft =>
  oneEdit(editBetween(project, node, "before", text))

export const insertAfter = (project: ProjectSnapshot, node: Node, text: string): Draft =>
  oneEdit(editBetween(project, node, "after", text))

export const createFile = (
  project: ProjectSnapshot,
  fileName: ProjectRelativePath.Type,
  content: string,
): Draft =>
  oneOperation({
    kind: "create",
    projectId: project.project.id,
    fileName,
    content,
    evidenceIds: [],
  })

export const deleteFile = (file: ProjectFile): Draft =>
  oneOperation({
    kind: "delete",
    projectId: file.project.project.id,
    fileName: file.fileName,
    initialHash: Sha256.digest(file.sourceFile.text),
    evidenceIds: [],
  })

export const moveFile = (file: ProjectFile, toFileName: ProjectRelativePath.Type): Draft =>
  oneOperation({
    kind: "move",
    projectId: file.project.project.id,
    fileName: file.fileName,
    toFileName,
    initialHash: Sha256.digest(file.sourceFile.text),
    evidenceIds: [],
  })

const isDraft = (proposed: Replacement | Draft): proposed is Draft =>
  Predicate.isObject(proposed) && "edits" in proposed

const proposedDraft = <A extends Node>(
  selection: Selection<A>,
  proposed: Replacement | Draft,
): Draft => {
  if (isDraft(proposed)) return proposed
  return Predicate.isString(proposed)
    ? replace(selection.project, selection.value, proposed)
    : replace(selection.project, proposed.node, proposed.text)
}

const selectionDraft = <A extends Node>(
  selection: Selection<A>,
  proposed: Replacement | Draft,
): Draft => {
  const { project, fileName, start, end, evidence } = selection
  const draft = proposedDraft(selection, proposed)
  const criteria = [...evidence]
  const reason = Sha256.digest(canonicalJson(criteria)).slice(0, 12)
  const id = `selection:${project.project.id}:${fileName}:${start}-${end}:${reason}`
  const cite = <C extends TextEdit | FileOperation>(change: C): C => ({
    ...change,
    evidenceIds: [...change.evidenceIds, id],
  })
  return {
    edits: draft.edits.map(cite),
    fileOperations: draft.fileOperations.map(cite),
    evidence: [
      ...draft.evidence,
      {
        id,
        kind: "selection",
        facts: { projectId: project.project.id, fileName, start, end, criteria },
      },
    ],
    matches: 1,
  }
}

export const replaceEach = <A extends Node>(
  selections: ReadonlyArray<Selection<A>>,
  replacement: (selection: Selection<A>) => Replacement | Draft,
): Draft =>
  concat(...selections.map((selection) => selectionDraft(selection, replacement(selection))))
