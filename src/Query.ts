import { matchesGlob } from "node:path"
import { Data, Effect, Order, Predicate, Stream } from "effect"
import {
  type CallExpression,
  type Identifier,
  type ImportDeclaration,
  type Node,
  type StringLiteral,
  SyntaxKind,
} from "typescript/unstable/ast"
import {
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportExpression,
  isImportTypeNode,
  isLiteralTypeNode,
  isStringLiteral,
  isBinaryExpression,
  isExportSpecifier,
  isImportClause,
  isImportSpecifier,
  isNamespaceImport,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isTypeNode,
} from "typescript/unstable/ast/is"
import type { Symbol as NativeSymbol, Type as NativeType } from "typescript/unstable/async"
import * as FileRef from "./FileRef.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"
import type {
  IntrinsicTypeName,
  ProjectFile,
  ProjectSnapshot,
  ProjectSnapshotError,
} from "./Workspace/index.ts"

export interface Selection<A> {
  readonly value: A
  readonly project: ProjectSnapshot
  readonly fileName: ProjectRelativePath.Type
  readonly start: number
  readonly end: number
}

export type Query<A, E = never, R = never> = Stream.Stream<Selection<A>, E, R>

export type Scope = ProjectSnapshot | ReadonlyArray<ProjectFile>

export interface Criterion<A, E = never, R = never> {
  readonly id: string
  readonly select: (
    selections: ReadonlyArray<Selection<A>>,
  ) => Effect.Effect<ReadonlyArray<boolean>, E, R>
}

export class CriterionOutputError extends Data.TaggedError("CriterionOutputError")<{
  readonly criterionId: string
  readonly expected: number
  readonly actual: number
}> {}

const validateAnswers = (
  criterionId: string,
  expected: number,
  answers: ReadonlyArray<boolean>,
): Effect.Effect<ReadonlyArray<boolean>, CriterionOutputError> =>
  answers.length === expected
    ? Effect.succeed(answers)
    : Effect.fail(new CriterionOutputError({ criterionId, expected, actual: answers.length }))

const isFiles = (scope: Scope): scope is ReadonlyArray<ProjectFile> => Array.isArray(scope)

const distinct = (files: ReadonlyArray<ProjectFile>): Iterable<ProjectFile> =>
  new Map(
    files.map((file) => [
      FileRef.key({ projectId: file.project.project.id, fileName: file.fileName }),
      file,
    ]),
  ).values()

const filesIn = (scope: Scope): Stream.Stream<ProjectFile, ProjectSnapshotError> =>
  isFiles(scope) ? Stream.fromIterable(distinct(scope)) : Stream.fromIterableEffect(scope.files)

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
  filesIn(scope).pipe(Stream.flatMap((file) => Stream.fromIterable(selectionsIn(file, guard))))

export const calls = (scope: Scope): Query<CallExpression, ProjectSnapshotError> =>
  nodes(scope, isCallExpression)

export const imports = (scope: Scope): Query<ImportDeclaration, ProjectSnapshotError> =>
  nodes(scope, isImportDeclaration)

export const identifiers = (scope: Scope): Query<Identifier, ProjectSnapshotError> =>
  nodes(scope, isIdentifier)

export type ModuleReferenceKind =
  | "import"
  | "export"
  | "dynamic-import"
  | "import-type"
  | "require"
  | "import-equals"

export interface ModuleReference {
  readonly node: Node
  readonly specifier: StringLiteral
  readonly kind: ModuleReferenceKind
  readonly typeOnly: boolean
}

const moduleReferenceOf = (node: Node): ModuleReference | undefined => {
  if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
    return {
      node,
      specifier: node.moduleSpecifier,
      kind: "import",
      typeOnly: node.importClause?.phaseModifier !== undefined,
    }
  }
  if (
    isExportDeclaration(node) &&
    node.moduleSpecifier !== undefined &&
    isStringLiteral(node.moduleSpecifier)
  ) {
    return { node, specifier: node.moduleSpecifier, kind: "export", typeOnly: node.isTypeOnly }
  }
  if (
    isImportEqualsDeclaration(node) &&
    isExternalModuleReference(node.moduleReference) &&
    isStringLiteral(node.moduleReference.expression)
  ) {
    return {
      node,
      specifier: node.moduleReference.expression,
      kind: "import-equals",
      typeOnly: node.isTypeOnly,
    }
  }
  if (
    isImportTypeNode(node) &&
    isLiteralTypeNode(node.argument) &&
    isStringLiteral(node.argument.literal)
  ) {
    return { node, specifier: node.argument.literal, kind: "import-type", typeOnly: true }
  }
  if (isCallExpression(node)) {
    const [specifier] = node.arguments
    if (specifier === undefined || !isStringLiteral(specifier)) return undefined
    if (isImportExpression(node.expression)) {
      return { node, specifier, kind: "dynamic-import", typeOnly: false }
    }
    if (isIdentifier(node.expression) && node.expression.text === "require") {
      return { node, specifier, kind: "require", typeOnly: false }
    }
  }
  return undefined
}

export const moduleReferences = (scope: Scope): Query<ModuleReference, ProjectSnapshotError> =>
  filesIn(scope).pipe(
    Stream.flatMap((file) =>
      Stream.fromIterable(
        selectionsIn(file, (node): node is Node => moduleReferenceOf(node) !== undefined),
      ),
    ),
    Stream.map((selection) => ({ ...selection, value: moduleReferenceOf(selection.value)! })),
  )

export interface ResolvedModuleReference extends ModuleReference {
  readonly resolved: ProjectFile | undefined
}

export const resolvedModuleReferences = (
  scope: Scope,
): Query<ResolvedModuleReference, ProjectSnapshotError> =>
  moduleReferences(scope).pipe(
    Stream.mapEffect((selection) =>
      selection.project
        .resolvedModule(selection.fileName, selection.value.specifier.getStart())
        .pipe(
          Effect.map((resolved) => ({ ...selection, value: { ...selection.value, resolved } })),
        ),
    ),
  )

export type ReferenceRole =
  | "declaration"
  | "read"
  | "write"
  | "type"
  | "import"
  | "export"
  | "property-name"
  | "shorthand"

export interface SemanticReference {
  readonly node: Identifier
  readonly role: ReferenceRole
}

const hasTypeAncestor = (node: Node): boolean => {
  let parent = node.parent
  for (;;) {
    if (isTypeNode(parent)) return true
    if (parent.getSourceFile() === parent) return false
    parent = parent.parent
  }
}

const roleOf = (node: Identifier): ReferenceRole => {
  const parent = node.parent
  if (
    isImportSpecifier(parent) ||
    isImportClause(parent) ||
    isNamespaceImport(parent) ||
    isImportEqualsDeclaration(parent)
  ) {
    return "import"
  }
  if (isExportSpecifier(parent)) return "export"
  if (isShorthandPropertyAssignment(parent)) return "shorthand"
  if (
    (isPropertyAccessExpression(parent) && parent.name === node) ||
    (isPropertyAssignment(parent) && parent.name === node)
  ) {
    return "property-name"
  }
  if (hasTypeAncestor(node)) return "type"
  if (isBinaryExpression(parent) && parent.left === node) {
    const operator = parent.operatorToken.kind
    if (operator >= SyntaxKind.FirstAssignment && operator <= SyntaxKind.LastAssignment)
      return "write"
  }
  if (
    (isPrefixUnaryExpression(parent) || isPostfixUnaryExpression(parent)) &&
    (parent.operator === SyntaxKind.PlusPlusToken || parent.operator === SyntaxKind.MinusMinusToken)
  ) {
    return "write"
  }
  const symbolParent = parent as Node & { readonly name?: Node }
  if (symbolParent.name === node && !isPropertyAssignment(parent)) return "declaration"
  return "read"
}

export const semanticReferences = (scope: Scope): Query<SemanticReference, ProjectSnapshotError> =>
  identifiers(scope).pipe(
    Stream.map((selection) => ({
      ...selection,
      value: { node: selection.value, role: roleOf(selection.value) },
    })),
  )

export const filter: {
  <A, B extends A>(
    refinement: (selection: Selection<A>) => selection is Selection<B>,
  ): <E, R>(self: Query<A, E, R>) => Query<B, E, R>
  <A>(
    predicate: (selection: Selection<A>) => boolean,
  ): <E, R>(self: Query<A, E, R>) => Query<A, E, R>
} = Stream.filter

export const within =
  (pattern: string) =>
  <A, E, R>(self: Query<A, E, R>): Query<A, E, R> =>
    Stream.filter(self, ({ fileName }) =>
      pattern.includes("*")
        ? matchesGlob(fileName, pattern.replaceAll("\\", "/"))
        : fileName === pattern,
    )

export const where =
  <A, E2, R2>(criterion: Criterion<A, E2, R2>) =>
  <E, R>(self: Query<A, E, R>): Query<A, E | E2 | CriterionOutputError, R | R2> =>
    self.pipe(
      Stream.grouped(128),
      Stream.mapEffect((batch) =>
        Effect.gen(function* () {
          const matches = yield* criterion.select(batch)
          yield* validateAnswers(criterion.id, batch.length, matches)
          return batch.filter((_, index) => matches[index])
        }),
      ),
      Stream.flatMap(Stream.fromIterable),
    )

export const collect = <A, E, R>(
  self: Query<A, E, R>,
): Effect.Effect<ReadonlyArray<Selection<A>>, E, R> =>
  Effect.map(Stream.runCollect(self), (selections) =>
    [...selections].sort(
      (left, right) =>
        Order.String(left.project.project.id, right.project.project.id) ||
        Order.String(left.fileName, right.fileName) ||
        left.start - right.start ||
        left.end - right.end,
    ),
  )

const perFile =
  <A extends Node, E>(
    criterionId: string,
    selectFile: (
      project: ProjectSnapshot,
      fileName: ProjectRelativePath.Type,
      values: ReadonlyArray<A>,
    ) => Effect.Effect<ReadonlyArray<boolean>, E>,
  ): Criterion<A, E | CriterionOutputError>["select"] =>
  (selections) =>
    Effect.gen(function* () {
      const matches = new Map<Selection<A>, boolean>()
      const groups = Map.groupBy(selections, (selection) => selection.project)
      for (const [project, inProject] of groups) {
        for (const [fileName, group] of Map.groupBy(inProject, (selection) => selection.fileName)) {
          const answers = yield* selectFile(
            project,
            fileName,
            group.map((selection) => selection.value),
          )
          yield* validateAnswers(criterionId, group.length, answers)
          group.forEach((selection, index) => matches.set(selection, answers[index]!))
        }
      }
      return selections.map((selection) => matches.get(selection)!)
    })

const startOf = (node: Node): number => node.getStart(node.getSourceFile())

export const resolvesTo = <A extends Node>(
  symbol: NativeSymbol,
  options?: { readonly location?: (candidate: A) => Node },
): Criterion<A, ProjectSnapshotError | CriterionOutputError> => {
  const targets = new Map<ProjectSnapshot, NativeSymbol>()
  return {
    id: "resolves-to-symbol",
    select: perFile("resolves-to-symbol", (project, fileName, values) =>
      Effect.gen(function* () {
        let target = targets.get(project)
        if (target === undefined) {
          target = yield* project.canonicalSymbol(symbol)
          targets.set(project, target)
        }
        const located = values.map((value) => options?.location?.(value) ?? value)
        const symbols = yield* project.symbolsAt(fileName, located.map(startOf))
        const canonical = new Map<NativeSymbol, NativeSymbol>()
        for (const candidate of new Set(symbols)) {
          if (candidate !== undefined) {
            canonical.set(candidate, yield* project.canonicalSymbol(candidate))
          }
        }
        return symbols.map(
          (candidate) => candidate !== undefined && canonical.get(candidate) === target,
        )
      }),
    ),
  }
}

export const typeAssignableTo = <A extends Node>(
  target: NativeType | IntrinsicTypeName,
): Criterion<A, ProjectSnapshotError | CriterionOutputError> => {
  const label = Predicate.isString(target) ? target : "custom-type"
  return {
    id: `type-assignable-to:${label}`,
    select: perFile(`type-assignable-to:${label}`, (project, fileName, values) =>
      Effect.gen(function* () {
        const expected = Predicate.isString(target) ? yield* project.intrinsicType(target) : target
        const types = yield* project.typesAt(fileName, values.map(startOf))
        return yield* Effect.forEach(types, (type) =>
          Effect.gen(function* () {
            if (type === undefined) return false
            return yield* project.isTypeAssignableTo(type, expected)
          }),
        )
      }),
    ),
  }
}
