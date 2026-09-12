/** Query sources over workspace snapshots. */
import { Effect, Stream } from "effect"
import {
  type CallExpression,
  type Identifier,
  type ImportDeclaration,
  type Node,
  type SourceFile,
  SyntaxKind,
} from "typescript/unstable/ast"
import { isCallExpression, isIdentifier, isImportDeclaration } from "typescript/unstable/ast/is"
import type { Symbol as NativeSymbol } from "typescript/unstable/async"
import { requireProjectRelativePath } from "../ProjectPath.ts"
import {
  isProjectFile,
  type ProjectFile,
  type ProjectSnapshot,
  type ProjectSnapshotError,
} from "../Workspace/ProjectSnapshot.ts"
import type { ProjectScope, Query, Selection } from "./Query.ts"

export type SyntaxKindFilter = SyntaxKind | ReadonlyArray<SyntaxKind>

const syntaxKindName = (kind: number): string =>
  // SAFETY: reverse-map coverage of every numeric member makes this total.
  SyntaxKind[kind]!

interface TargetFileScope {
  readonly project: ProjectSnapshot
  readonly fileName: string
}

const isProjectFileArray = (value: ProjectScope): value is ReadonlyArray<ProjectFile> =>
  Array.isArray(value)

const resolveScope = (
  scope: ProjectScope,
): Stream.Stream<TargetFileScope, ProjectSnapshotError> => {
  if (isProjectFileArray(scope)) {
    if (scope.length === 0) {
      return Stream.empty
    }
    const seen = new Set<string>()
    const uniqueFiles: Array<TargetFileScope> = []
    for (const f of scope) {
      const key = `${f.project.project.id}:${f.path}`
      const fileName = f.project.resolveFileName(f.path)
      if (!seen.has(key) && f.project.containsFileName(fileName)) {
        seen.add(key)
        uniqueFiles.push({
          project: f.project,
          fileName,
        })
      }
    }
    return Stream.fromIterable(uniqueFiles)
  }
  if (isProjectFile(scope)) {
    const fileName = scope.project.resolveFileName(scope.path)
    return scope.project.containsFileName(fileName)
      ? Stream.make({
          project: scope.project,
          fileName,
        })
      : Stream.empty
  }
  return Stream.fromIterableEffect(
    scope.files.pipe(
      Effect.map((projectFiles) =>
        projectFiles.flatMap((file) => {
          const fileName = file.project.resolveFileName(file.path)
          return file.project.containsFileName(fileName) ? [{ project: scope, fileName }] : []
        }),
      ),
    ),
  )
}

const forEachMatchingNode = (
  root: Node,
  syntaxKind: SyntaxKindFilter | undefined,
  visit: (node: Node) => void,
): void => {
  const walk = (node: Node): void => {
    const kindMatches =
      syntaxKind === undefined ||
      (Array.isArray(syntaxKind) ? syntaxKind.includes(node.kind) : node.kind === syntaxKind)
    if (kindMatches) visit(node)
    node.forEachChild(walk)
  }
  walk(root)
}
const collectNodes = <A extends Node>(
  project: ProjectSnapshot,
  sourceFile: SourceFile,
  guard: (node: Node) => node is A,
  syntaxKind?: SyntaxKindFilter,
): Array<Selection<A>> => {
  const fileName = requireProjectRelativePath(project.relativeFileName(sourceFile.fileName))
  const selections: Array<Selection<A>> = []
  forEachMatchingNode(sourceFile, syntaxKind, (node) => {
    if (!guard(node)) return
    selections.push({
      value: node,
      project,
      fileName,
      start: node.getStart(sourceFile),
      end: node.getEnd(),
      evidence: [
        {
          criterion: "syntax-kind",
          facts: { kind: syntaxKindName(node.kind) },
        },
      ],
    })
  })
  return selections
}

/** All descendant nodes of the given kind, in every file the project checks. */
export const nodes = <A extends Node>(
  target: ProjectScope,
  guard: (node: Node) => node is A,
  syntaxKind?: SyntaxKindFilter,
): Query<A, ProjectSnapshotError> =>
  resolveScope(target).pipe(
    Stream.flatMap(({ project, fileName }) =>
      Stream.fromIterableEffect(
        project
          .sourceFile(fileName)
          .pipe(
            Effect.map((sourceFile) =>
              sourceFile === undefined ? [] : collectNodes(project, sourceFile, guard, syntaxKind),
            ),
          ),
      ),
    ),
  )

export const calls = (target: ProjectScope): Query<CallExpression, ProjectSnapshotError> =>
  nodes(target, isCallExpression, SyntaxKind.CallExpression)

export const imports = (target: ProjectScope): Query<ImportDeclaration, ProjectSnapshotError> =>
  nodes(target, isImportDeclaration, SyntaxKind.ImportDeclaration)

export const identifiers = (target: ProjectScope): Query<Identifier, ProjectSnapshotError> =>
  nodes(target, isIdentifier, SyntaxKind.Identifier)

/** Find references to a symbol in every file selected by the target scope. */
export const referencesTo = (
  target: ProjectScope,
  symbol: NativeSymbol,
): Query<Identifier, ProjectSnapshotError> =>
  resolveScope(target).pipe(
    Stream.flatMap(({ project, fileName }) =>
      Stream.fromIterableEffect(
        Effect.gen(function* () {
          const sourceFile = yield* project.sourceFile(fileName)
          if (sourceFile === undefined) return []
          const references = yield* project.referencesToSymbolInFile(fileName, symbol)
          const relativeFileName = requireProjectRelativePath(
            project.relativeFileName(sourceFile.fileName),
          )
          const declarationFile = symbol.valueDeclaration?.path ?? symbol.declarations[0]?.path
          const declarationPath =
            declarationFile === undefined
              ? "unknown"
              : project.containsFileName(String(declarationFile))
                ? project.relativeFileName(String(declarationFile))
                : "external"
          return references.map((node): Selection<Identifier> => ({
            value: node,
            project,
            fileName: relativeFileName,
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            evidence: [
              {
                criterion: "syntax-kind",
                facts: { kind: syntaxKindName(node.kind) },
              },
              {
                criterion: "resolves-to-symbol",
                facts: { symbol: symbol.name, declarationFile: declarationPath },
              },
            ],
          }))
        }),
      ),
    ),
  )
