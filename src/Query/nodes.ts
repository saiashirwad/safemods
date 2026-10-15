import { Effect, Option } from "effect"
import type {
  ArrowFunction,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  ImportDeclaration,
  Node,
} from "typescript/unstable/ast"
import {
  isArrowFunction,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isVariableDeclaration,
} from "typescript/unstable/ast/is"
import * as Pattern from "../Pattern.ts"
import type * as WorkspacePath from "../WorkspacePath.ts"
import { NodeNotOwned } from "../Workspace/ProjectSnapshot.ts"
import type { ProjectFile, ProjectSnapshot, ProjectSnapshotError } from "../Workspace/index.ts"
import { keepDefined, type Query, type Selection, sorted } from "./selection.ts"

export type Scope = ProjectSnapshot | ReadonlyArray<ProjectFile>

const isFiles = (scope: Scope): scope is ReadonlyArray<ProjectFile> => Array.isArray(scope)

const filesIn = (scope: Scope): Effect.Effect<ReadonlyArray<ProjectFile>, ProjectSnapshotError> => {
  if (!isFiles(scope)) return scope.files
  return Effect.gen(function* () {
    const seen = new Map<ProjectSnapshot, Set<WorkspacePath.Type>>()
    const files: Array<ProjectFile> = []
    for (const file of scope) {
      const ownedName = file.project.fileNameOf(file.sourceFile)
      if (Option.isNone(ownedName) || ownedName.value !== file.fileName) {
        return yield* new NodeNotOwned({ fileName: file.sourceFile.fileName })
      }
      let names = seen.get(file.project)
      if (names === undefined) {
        names = new Set()
        seen.set(file.project, names)
      }
      if (!names.has(file.fileName)) {
        names.add(file.fileName)
        files.push(file)
      }
    }
    return files
  })
}

const selectionsIn = <A extends Node>(
  file: ProjectFile,
  guard: (node: Node) => node is A,
): ReadonlyArray<Selection<A>> => {
  const selections: Array<Selection<A>> = []
  const visit = (node: Node): void => {
    if (guard(node)) {
      selections.push({
        value: node,
        project: file.project,
        fileName: file.fileName,
        start: node.getStart(file.sourceFile),
        end: node.getEnd(),
      })
    }
    node.forEachChild(visit)
  }
  visit(file.sourceFile)
  return selections
}

export const nodes = <A extends Node>(
  scope: Scope,
  guard: (node: Node) => node is A,
): Query<A, ProjectSnapshotError> =>
  Effect.map(filesIn(scope), (files) => sorted(files.flatMap((file) => selectionsIn(file, guard))))

export const match = <const Patterns extends Pattern.Tagged>(
  scope: Scope,
  patterns: Patterns,
): Query<Pattern.MatchedOf<Patterns>, ProjectSnapshotError> => {
  const matchedOf = Pattern.tagged(patterns)
  const guards = Object.values(patterns).map(({ guard }) => guard)
  return keepDefined(
    nodes(scope, (node): node is Node => guards.some((guard) => guard(node))),
    (selection) => Effect.succeed(matchedOf(selection.value)),
  )
}

export interface Shaped<A extends Node, C> {
  readonly node: A
  readonly captures: C
}

export const shape = <const F extends object>(fields: F) =>
<A extends Node, E, R>(
  self: Query<A, E, R> & Pattern.FieldsError<A, F>,
): Query<Shaped<A, Pattern.CapturesOf<A, F>>, E, R> => {
  const pattern = Pattern.unguarded<A, F>(fields)
  return keepDefined(self, ({ value }) => {
    const captures = pattern.match(value)
    return Effect.succeed(captures === undefined ? undefined : { node: value, captures })
  })
}

export const calls = (scope: Scope): Query<CallExpression, ProjectSnapshotError> =>
  nodes(scope, isCallExpression)

export const imports = (scope: Scope): Query<ImportDeclaration, ProjectSnapshotError> =>
  nodes(scope, isImportDeclaration)

export const identifiers = (scope: Scope): Query<Identifier, ProjectSnapshotError> =>
  nodes(scope, isIdentifier)

export interface NamedFunction {
  readonly node: FunctionDeclaration | ArrowFunction | FunctionExpression
  readonly name: Identifier
}

const namedFunctionOf = (node: Node): NamedFunction | undefined => {
  if (isFunctionDeclaration(node)) {
    return node.name === undefined ? undefined : { node, name: node.name }
  }
  if (
    (isArrowFunction(node) || isFunctionExpression(node)) &&
    isVariableDeclaration(node.parent) &&
    isIdentifier(node.parent.name)
  ) {
    return { node, name: node.parent.name }
  }
  return undefined
}

export const namedFunctions = (scope: Scope): Query<NamedFunction, ProjectSnapshotError> =>
  Effect.map(
    nodes(scope, (node): node is Node => namedFunctionOf(node) !== undefined),
    (all) =>
      sorted(all.map((selection) => {
        const value = namedFunctionOf(selection.value)!
        return {
          ...selection,
          value,
          start: value.name.getStart(value.name.getSourceFile()),
          end: value.name.getEnd(),
        }
      })),
  )
