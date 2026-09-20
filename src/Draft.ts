import type { Node, StringLiteral } from "typescript/unstable/ast"
import { textEdit, type TextEdit } from "./Edit.ts"
import type { FileOperation, UnsupportedFinding } from "./Plan.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"
import type { Selection } from "./Query.ts"
import type { ProjectFile, ProjectSnapshot, TextFile } from "./Workspace/index.ts"

export interface Draft {
  readonly edits: ReadonlyArray<TextEdit>
  readonly fileOperations: ReadonlyArray<FileOperation>
  readonly unsupported: ReadonlyArray<UnsupportedFinding>
}

export const empty: Draft = { edits: [], fileOperations: [], unsupported: [] }

export const concat = (...drafts: ReadonlyArray<Draft>): Draft => ({
  edits: drafts.flatMap((draft) => draft.edits),
  fileOperations: drafts.flatMap((draft) => draft.fileOperations),
  unsupported: drafts.flatMap((draft) => draft.unsupported),
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
  const fileName = project.fileNameOf(sourceFile)
  if (fileName._tag === "None") throw new Error("Node is not in project")
  return textEdit({
    projectId: project.project.id,
    fileName: fileName.value,
    sourceText: sourceFile.text,
    start,
    end,
    newText,
  })
}

const oneEdit = (edit: TextEdit): Draft => ({ ...empty, edits: [edit] })

const oneOperation = (operation: FileOperation): Draft => ({
  ...empty,
  fileOperations: [operation],
})

export const unsupported = <A>(selection: Selection<A>, reason: string): Draft => ({
  ...empty,
  unsupported: [
    {
      projectId: selection.project.project.id,
      fileName: selection.fileName,
      start: selection.start,
      end: selection.end,
      reason,
    },
  ],
})

export const replace = (project: ProjectSnapshot, node: Node, newText: string): Draft =>
  oneEdit(editBetween(project, node, "node", newText))

export const replaceStringLiteral = (
  project: ProjectSnapshot,
  literal: StringLiteral,
  text: string,
): Draft => {
  const quote = literal.getText().startsWith("'") ? "'" : '"'
  return replace(project, literal, `${quote}${text}${quote}`)
}

export const replaceSelection = <A extends Node>(selection: Selection<A>, newText: string): Draft =>
  oneEdit(
    textEdit({
      projectId: selection.project.project.id,
      fileName: selection.fileName,
      sourceText: selection.value.getSourceFile().text,
      start: selection.start,
      end: selection.end,
      newText,
    }),
  )

export const replaceRange = <A extends Node>(
  selection: Selection<A>,
  range: { readonly start: number; readonly end: number },
  newText: string,
): Draft => {
  if (range.start < 0 || range.end < range.start || selection.start + range.end > selection.end) {
    throw new Error("Range is outside selection")
  }
  return oneEdit(
    textEdit({
      projectId: selection.project.project.id,
      fileName: selection.fileName,
      sourceText: selection.value.getSourceFile().text,
      start: selection.start + range.start,
      end: selection.start + range.end,
      newText,
    }),
  )
}

export const remove = (project: ProjectSnapshot, node: Node): Draft => replace(project, node, "")

export const insertBefore = (project: ProjectSnapshot, node: Node, text: string): Draft =>
  oneEdit(editBetween(project, node, "before", text))

export const insertAfter = (project: ProjectSnapshot, node: Node, text: string): Draft =>
  oneEdit(editBetween(project, node, "after", text))

export const replaceText = (file: TextFile, newText: string): Draft =>
  oneEdit(
    textEdit({
      projectId: file.project.project.id,
      fileName: file.fileName,
      sourceText: file.text,
      start: 0,
      end: file.text.length,
      newText,
    }),
  )

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
  })

export const deleteFile = (file: ProjectFile | TextFile): Draft =>
  oneOperation({
    kind: "delete",
    projectId: file.project.project.id,
    fileName: file.fileName,
  })

export const moveFile = (
  file: ProjectFile | TextFile,
  toFileName: ProjectRelativePath.Type,
): Draft =>
  oneOperation({
    kind: "move",
    projectId: file.project.project.id,
    fileName: file.fileName,
    toFileName,
  })

export const replaceEach = <A extends Node>(
  selections: ReadonlyArray<Selection<A>>,
  replacement: (selection: Selection<A>) => string,
): Draft =>
  concat(...selections.map((selection) => replaceSelection(selection, replacement(selection))))
