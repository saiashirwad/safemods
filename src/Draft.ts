import type { Node } from "typescript/unstable/ast"
import { textEdit, type TextEdit } from "./Edit.ts"
import type { FileOperation } from "./Plan.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"
import type { Selection } from "./Query.ts"
import type { ProjectFile, ProjectSnapshot } from "./Workspace/index.ts"

export interface Draft {
  readonly edits: ReadonlyArray<TextEdit>
  readonly fileOperations: ReadonlyArray<FileOperation>
}

export const empty: Draft = { edits: [], fileOperations: [] }

export const concat = (...drafts: ReadonlyArray<Draft>): Draft => ({
  edits: drafts.flatMap((draft) => draft.edits),
  fileOperations: drafts.flatMap((draft) => draft.fileOperations),
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

const oneEdit = (edit: TextEdit): Draft => ({ ...empty, edits: [edit] })

const oneOperation = (operation: FileOperation): Draft => ({
  ...empty,
  fileOperations: [operation],
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
  })

export const deleteFile = (file: ProjectFile): Draft =>
  oneOperation({
    kind: "delete",
    projectId: file.project.project.id,
    fileName: file.fileName,
  })

export const moveFile = (file: ProjectFile, toFileName: ProjectRelativePath.Type): Draft =>
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
  concat(
    ...selections.map((selection) =>
      replace(selection.project, selection.value, replacement(selection)),
    ),
  )
