import { matchesGlob } from "node:path"
import { Effect, Option, Order, Predicate, Stream } from "effect"
import {
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Identifier,
  type ImportDeclaration,
  type Node,
  type StringLiteral,
  SyntaxKind,
} from "typescript/unstable/ast"
import {
  isArrowFunction,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isVariableDeclaration,
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
import * as Pattern from "./Pattern.ts"
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

export const match = <const Patterns extends Pattern.Tagged>(
  scope: Scope,
  patterns: Patterns,
): Query<Pattern.MatchedOf<Patterns>, ProjectSnapshotError> => {
  const matchedOf = Pattern.tagged(patterns)
  const guards = Object.values(patterns).map(({ guard }) => guard)
  return nodes(scope, (node): node is Node => guards.some((guard) => guard(node))).pipe(
    Stream.map((selection) => ({ ...selection, value: matchedOf(selection.value) })),
    Stream.filter(
      (selection): selection is Selection<Pattern.MatchedOf<Patterns>> =>
        selection.value !== undefined,
    ),
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
  return self.pipe(
    Stream.map((selection) => ({
      ...selection,
      value: { node: selection.value, captures: pattern.match(selection.value) },
    })),
    Stream.filter(
      (selection): selection is Selection<Shaped<A, Pattern.CapturesOf<A, F>>> =>
        selection.value.captures !== undefined,
    ),
  )
}

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
      )
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
      Effect.map(selection.project.resolvedModule(selection.value.specifier), (resolved) => ({
        ...selection,
        value: { ...selection.value, resolved },
      }))
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
    if (operator >= SyntaxKind.FirstAssignment && operator <= SyntaxKind.LastAssignment) {
      return "write"
    }
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

export const within = (pattern: string) => <A, E, R>(self: Query<A, E, R>): Query<A, E, R> =>
  Stream.filter(self, ({ fileName }) =>
    pattern.includes("*") ?
      matchesGlob(fileName, pattern.replaceAll("\\", "/")) :
      fileName === pattern)

export const where =
  <A, E2, R2>(test: (selection: Selection<A>) => Effect.Effect<boolean, E2, R2>) =>
  <E, R>(self: Query<A, E, R>): Query<A, E | E2, R | R2> =>
    self.pipe(
      Stream.mapEffect(
        (selection) =>
          Effect.map(test(selection), (keep) => (keep ? Option.some(selection) : Option.none())),
        { concurrency: "unbounded" },
      ),
      Stream.filter(Option.isSome),
      Stream.map((kept) => kept.value),
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
    ))

export const selectionOf = <A extends Node>(
  project: ProjectSnapshot,
  node: A,
): Option.Option<Selection<A>> =>
  Option.map(project.fileNameOf(node.getSourceFile()), (fileName) => ({
    value: node,
    project,
    fileName,
    start: node.getStart(node.getSourceFile()),
    end: node.getEnd(),
  }))

export const referencesTo = (selection: Selection<Node>): Query<Node, ProjectSnapshotError> =>
  Stream.fromIterableEffect(
    Effect.map(
      selection.project.referencesTo(selection.value),
      (nodes) => nodes.flatMap((node) => Option.toArray(selectionOf(selection.project, node))),
    ),
  )

export interface Uses {
  readonly calls: ReadonlyArray<Selection<CallExpression>>
  readonly escapes: boolean
}

export const usesOf = (selection: Selection<Node>): Effect.Effect<Uses, ProjectSnapshotError> =>
  Effect.map(collect(referencesTo(selection)), (references) => {
    const calls: Array<Selection<CallExpression>> = []
    let escapes = false
    for (const { project, value } of references) {
      if (
        value === selection.value ||
        isImportSpecifier(value.parent) ||
        (isImportClause(value.parent) && value.parent.name === value)
      ) {
        continue
      }
      const callee = isPropertyAccessExpression(value.parent) && value.parent.name === value ?
        value.parent :
        value
      const call = isCallExpression(callee.parent) && callee.parent.expression === callee ?
        selectionOf(project, callee.parent) :
        Option.none()
      if (Option.isSome(call)) calls.push(call.value)
      else escapes = true
    }
    return { calls, escapes }
  })

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
  nodes(scope, (node): node is Node => namedFunctionOf(node) !== undefined).pipe(
    Stream.map((selection) => {
      const value = namedFunctionOf(selection.value)!
      return {
        ...selection,
        value,
        start: value.name.getStart(value.name.getSourceFile()),
        end: value.name.getEnd(),
      }
    }),
  )

export interface TypedNode<A extends Node> {
  readonly node: A
  readonly type: NativeType
}

export const typed = <A extends Node, E, R>(
  self: Query<A, E, R>,
): Query<TypedNode<A>, E | ProjectSnapshotError, R> =>
  self.pipe(
    Stream.mapEffect(
      (selection) =>
        Effect.map(selection.project.typeOf(selection.value), (type) =>
          type === undefined ?
            Option.none() :
            Option.some({ ...selection, value: { node: selection.value, type } })),
      { concurrency: "unbounded" },
    ),
    Stream.filter(Option.isSome),
    Stream.map((kept) => kept.value),
  )

type CaptureTypes<C> = {
  readonly [K in keyof C as C[K] extends Node ? K : never]: NativeType | undefined
}

export type WithTypes<M> = M extends { readonly captures: infer C } ?
  M & { readonly types: CaptureTypes<C> } :
  never

export const typedCaptures = <M extends { readonly captures: object }, E, R>(
  self: Query<M, E, R>,
): Query<WithTypes<M>, E | ProjectSnapshotError, R> =>
  Stream.mapEffect(
    self,
    (selection) =>
      Effect.map(
        Effect.forEach(
          Object.entries(selection.value.captures).filter(([, captured]) =>
            Pattern.isNode(captured)
          ),
          ([name, captured]) =>
            Effect.map(selection.project.typeOf(captured), (type) => [name, type] as const),
          { concurrency: "unbounded" },
        ),
        (types) =>
          ({
            ...selection,
            value: { ...selection.value, types: Object.fromEntries(types) },
          }) as Selection<WithTypes<M>>,
      ),
    { concurrency: "unbounded" },
  )

export const resolvesTo = <A extends Node>(
  symbol: NativeSymbol,
  options?: { readonly location?: (candidate: A) => Node },
) =>
({ project, value }: Selection<A>): Effect.Effect<boolean, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const candidate = yield* project.symbolOf(options?.location?.(value) ?? value)
    if (candidate === undefined) return false
    return (
      (yield* project.canonicalSymbol(candidate)) === (yield* project.canonicalSymbol(symbol))
    )
  })

const sameNode = (left: Node, right: Node): boolean =>
  left.pos === right.pos &&
  left.end === right.end &&
  left.kind === right.kind &&
  left.getSourceFile().fileName === right.getSourceFile().fileName

export const resolvesToSignature =
  (declarations: ReadonlyArray<Node>) =>
  ({ project, value }: Selection<CallExpression>): Effect.Effect<boolean, ProjectSnapshotError> =>
    Effect.gen(function* () {
      const signature = yield* project.resolvedSignature(value)
      if (signature === undefined) return false
      const resolved = yield* project.signatureDeclaration(signature)
      return (
        resolved !== undefined &&
        declarations.some((declaration) => sameNode(declaration, resolved))
      )
    })

export const typeAssignableTo =
  <A extends Node>(target: NativeType | IntrinsicTypeName) =>
  ({ project, value }: Selection<A>): Effect.Effect<boolean, ProjectSnapshotError> =>
    Effect.gen(function* () {
      const type = yield* project.typeOf(value)
      if (type === undefined) return false
      const expected = Predicate.isString(target) ? yield* project.intrinsicType(target) : target
      return yield* project.isTypeAssignableTo(type, expected)
    })
