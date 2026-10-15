import type { Node, StringLiteral } from "typescript/unstable/ast"
import { textEdit, type TextEdit } from "./Edit.ts"
import type { Issue } from "./Finding.ts"
import type * as WorkspacePath from "./WorkspacePath.ts"
import type { Selection } from "./Query/index.ts"
import type { ProjectFile, ProjectSnapshot } from "./Workspace/index.ts"

export type { TextEdit } from "./Edit.ts"

export type FileOperation =
  | { readonly kind: "create"; readonly fileName: WorkspacePath.Type; readonly content: string }
  | { readonly kind: "delete"; readonly fileName: WorkspacePath.Type }
  | {
    readonly kind: "move"
    readonly fileName: WorkspacePath.Type
    readonly toFileName: WorkspacePath.Type
  }

export interface Policies {
  readonly maxAffectedFiles?: number
  readonly diagnostics: "no-new-errors" | "allow-new-errors"
  readonly idempotence: "required" | "not-promised"
}

export interface Plan {
  readonly edits: ReadonlyArray<TextEdit>
  readonly fileOperations: ReadonlyArray<FileOperation>
  readonly unsupported: ReadonlyArray<Issue>
}

export const empty: Plan = { edits: [], fileOperations: [], unsupported: [] }

export const concat = (...drafts: ReadonlyArray<Plan>): Plan => ({
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
    fileName: fileName.value,
    sourceText: sourceFile.text,
    start,
    end,
    newText,
  })
}

const oneEdit = (edit: TextEdit): Plan => ({ ...empty, edits: [edit] })

const oneOperation = (operation: FileOperation): Plan => ({
  ...empty,
  fileOperations: [operation],
})

export const unsupported = <A>(selection: Selection<A>, message: string): Plan => ({
  ...empty,
  unsupported: [
    {
      fileName: selection.fileName,
      start: selection.start,
      end: selection.end,
      message,
    },
  ],
})

export const replaceNode = (project: ProjectSnapshot, node: Node, newText: string): Plan =>
  oneEdit(editBetween(project, node, "node", newText))

export const replaceStringLiteral = (
  project: ProjectSnapshot,
  literal: StringLiteral,
  text: string,
): Plan => {
  const quote = literal.getText().startsWith("'") ? "'" : '"'
  const escaped = JSON.stringify(text).slice(1, -1)
  return replaceNode(
    project,
    literal,
    quote === "'" ? `'${escaped.replace(/'/g, "\\'")}'` : `"${escaped}"`,
  )
}

export const replaceSelection = <A extends Node>(
  selection: Selection<A>,
  newText: string,
): Plan =>
  oneEdit(
    textEdit({
      fileName: selection.fileName,
      sourceText: selection.value.getSourceFile().text,
      start: selection.start,
      end: selection.end,
      newText,
    }),
  )

export const replaceWithinSelection = <A extends Node>(
  selection: Selection<A>,
  range: { readonly start: number; readonly end: number },
  newText: string,
): Plan => {
  if (range.start < 0 || range.end < range.start || selection.start + range.end > selection.end) {
    throw new Error("Range is outside selection")
  }
  return oneEdit(
    textEdit({
      fileName: selection.fileName,
      sourceText: selection.value.getSourceFile().text,
      start: selection.start + range.start,
      end: selection.start + range.end,
      newText,
    }),
  )
}

export const remove = (project: ProjectSnapshot, node: Node): Plan => replaceNode(project, node, "")

export const insertBefore = (project: ProjectSnapshot, node: Node, text: string): Plan =>
  oneEdit(editBetween(project, node, "before", text))

export const insertAfter = (project: ProjectSnapshot, node: Node, text: string): Plan =>
  oneEdit(editBetween(project, node, "after", text))

export const replaceFile = (file: ProjectFile, newText: string): Plan =>
  oneEdit(
    textEdit({
      fileName: file.fileName,
      sourceText: file.sourceFile.text,
      start: 0,
      end: file.sourceFile.text.length,
      newText,
    }),
  )

export const createFile = (fileName: WorkspacePath.Type, content: string): Plan =>
  oneOperation({
    kind: "create",
    fileName,
    content,
  })

export const deleteFile = (file: ProjectFile): Plan =>
  oneOperation({
    kind: "delete",
    fileName: file.fileName,
  })

export const moveFile = (
  file: ProjectFile,
  toFileName: WorkspacePath.Type,
): Plan =>
  oneOperation({
    kind: "move",
    fileName: file.fileName,
    toFileName,
  })

export const replaceEach = <A extends Node>(
  selections: ReadonlyArray<Selection<A>>,
  replacement: (selection: Selection<A>) => string,
): Plan =>
  concat(...selections.map((selection) => replaceSelection(selection, replacement(selection))))
