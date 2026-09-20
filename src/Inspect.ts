import * as Path from "node:path"
import { Data, Effect } from "effect"
import type { Node } from "typescript/unstable/ast"
import * as Position from "./Position.ts"
import * as ProjectRelativePath from "./ProjectRelativePath.ts"
import * as Query from "./Query.ts"
import * as Type from "./Type.ts"
import {
  type ProjectFile,
  type ProjectSnapshot,
  Workspace,
  WorkspaceSnapshot,
} from "./Workspace/index.ts"

export class NotFound extends Data.TaggedError("NotFound")<{ readonly what: string }> {}

interface Target {
  readonly project: ProjectSnapshot
  readonly file: ProjectFile
  readonly node: Node
}

const lineText = (node: Node): string => {
  const file = node.getSourceFile()
  const { line, column } = Position.at(file.text, node.getStart(file))
  return `${line}:${column}  ${file.text.split("\n")[line - 1]!.trim().slice(0, 110)}`
}

const located = (project: ProjectSnapshot, node: Node): string => {
  const fileName = project.fileNameOf(node.getSourceFile())
  return `${fileName._tag === "Some" ? fileName.value : node.getSourceFile().fileName}:${lineText(node)}`
}

const innermost = (node: Node, offset: number): Node => {
  let found = node
  node.forEachChild((child) => {
    if (
      found === node &&
      child.getStart(node.getSourceFile()) <= offset &&
      offset < child.getEnd()
    ) {
      found = innermost(child, offset)
    }
  })
  return found
}

const fileNamed = (path: string) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const snapshot = yield* WorkspaceSnapshot
    const absolute = Path.resolve(workspace.root, path)
    for (const project of snapshot.projects) {
      const root = yield* workspace.projectRoot(project.project.id)
      const fileName = ProjectRelativePath.decodeWorkspaceFile(Path.relative(root, absolute))
      const file = fileName === undefined ? undefined : yield* project.file(fileName)
      if (file !== undefined) return { project, file }
    }
    return yield* new NotFound({ what: `${path} is not a file of any configured project` })
  })

const targetAt = (position: string) =>
  Effect.gen(function* () {
    const [path, line, column] = position.split(":")
    if (path === undefined || line === undefined) {
      return yield* new NotFound({ what: `${position} is not path:line:column` })
    }
    const { project, file } = yield* fileNamed(path)
    const lines = file.sourceFile.text.split("\n").slice(0, Number(line) - 1)
    const offset =
      lines.reduce((total, text) => total + text.length + 1, 0) + Number(column ?? 1) - 1
    return { project, file, node: innermost(file.sourceFile, offset) } satisfies Target
  })

export const type = (position: string) =>
  Effect.gen(function* () {
    const { project, node } = yield* targetAt(position)
    const found = yield* project.typeOf(node)
    const symbol = yield* project.symbolOf(node)
    const declared = symbol === undefined ? [] : yield* project.declarationsOf(symbol)
    return [
      `node      ${node.getText().replace(/\s+/g, " ").slice(0, 80)}`,
      `type      ${found === undefined ? "none" : yield* project.typeToString(found)}`,
      ...declared.map((declaration) => `declared  ${located(project, declaration)}`),
    ]
  })

export const refs = (position: string) =>
  Effect.gen(function* () {
    const { project, node } = yield* targetAt(position)
    const references = yield* project.referencesTo(node)
    return references.map((reference) => located(project, reference)).sort()
  })

export const calls = (position: string) =>
  Effect.gen(function* () {
    const { project, file, node } = yield* targetAt(position)
    const selection = { value: node, project, fileName: file.fileName, start: 0, end: 0 }
    const { calls: found, escapes } = yield* Query.usesOf(selection)
    return [
      ...found.map(({ value }) => located(project, value)).sort(),
      ...(escapes
        ? ["note: also used other than by a direct call, so more callers may exist"]
        : []),
    ]
  })

export const exports = (path: string) =>
  Effect.gen(function* () {
    const { project, file } = yield* fileNamed(path)
    const exported = yield* project.exportsOf(file)
    return yield* Effect.forEach(
      exported,
      ({ name, symbol }) =>
        Effect.gen(function* () {
          const found = yield* Type.ofSymbol(project, symbol)
          const printed = found === undefined ? "" : yield* project.typeToString(found)
          return `${name}: ${printed.replace(/\s+/g, " ").slice(0, 120)}`
        }),
      { concurrency: "unbounded" },
    )
  })

const edges = (project: ProjectSnapshot) =>
  Effect.map(Query.collect(Query.resolvedModuleReferences(project)), (references) =>
    references.flatMap(({ fileName, value }) =>
      value.resolved === undefined ? [] : [{ from: fileName, to: value.resolved.fileName }],
    ),
  )

export const deps = (path: string) =>
  Effect.gen(function* () {
    const { project, file } = yield* fileNamed(path)
    const all = yield* edges(project)
    const unique = (names: ReadonlyArray<string>) => [...new Set(names)].sort()
    return [
      ...unique(all.filter(({ from }) => from === file.fileName).map(({ to }) => to)).map(
        (name) => `imports      ${name}`,
      ),
      ...unique(all.filter(({ to }) => to === file.fileName).map(({ from }) => from)).map(
        (name) => `imported by  ${name}`,
      ),
    ]
  })

export const map = Effect.gen(function* () {
  const snapshot = yield* WorkspaceSnapshot
  const rows = yield* Effect.forEach(snapshot.projects, (project) =>
    Effect.gen(function* () {
      const files = yield* project.files
      const all = yield* edges(project)
      return yield* Effect.forEach(
        files,
        (file) =>
          Effect.map(project.exportsOf(file), (exported) => ({
            fileName: file.fileName,
            lines: file.sourceFile.text.split("\n").length,
            exports: exported.length,
            importedBy: new Set(
              all.filter(({ to }) => to === file.fileName).map(({ from }) => from),
            ).size,
            imports: new Set(all.filter(({ from }) => from === file.fileName).map(({ to }) => to))
              .size,
          })),
        { concurrency: "unbounded" },
      )
    }),
  )
  return [
    "lines  exports  imported-by  imports  file",
    ...rows
      .flat()
      .sort((left, right) => right.importedBy - left.importedBy || right.lines - left.lines)
      .map(
        (row) =>
          `${String(row.lines).padStart(5)}  ${String(row.exports).padStart(7)}  ${String(row.importedBy).padStart(11)}  ${String(row.imports).padStart(7)}  ${row.fileName}`,
      ),
  ]
})
