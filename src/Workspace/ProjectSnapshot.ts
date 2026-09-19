import * as Path from "node:path"
import { Data, Effect, Exit, Option, Request, RequestResolver, Schema } from "effect"
import type { CallExpression, Expression, Node, SourceFile } from "typescript/unstable/ast"
import {
  type NodeHandle,
  SignatureKind,
  SymbolFlags,
  type Project as NativeProject,
  type Signature as NativeSignature,
  type Symbol as NativeSymbol,
  type Type as NativeType,
} from "typescript/unstable/async"
import * as ProjectRelativePath from "../ProjectRelativePath.ts"
import type * as ConfiguredProject from "./ConfiguredProject.ts"
import { nativeRequest, type WorkspaceCompilerError } from "./NativeRequest.ts"

export class SnapshotExpired extends Data.TaggedError("SnapshotExpired")<{}> {}

export class SymbolNotFound extends Data.TaggedError("SymbolNotFound")<{
  readonly name: string
  readonly fileName: ProjectRelativePath.Type
}> {}

export type ProjectSnapshotError = WorkspaceCompilerError | SnapshotExpired

const intrinsicTypeGetters = {
  string: "getStringType",
  number: "getNumberType",
  boolean: "getBooleanType",
  any: "getAnyType",
  unknown: "getUnknownType",
  never: "getNeverType",
  void: "getVoidType",
} as const

export type IntrinsicTypeName = keyof typeof intrinsicTypeGetters

export interface ProjectFile {
  readonly project: ProjectSnapshot
  readonly fileName: ProjectRelativePath.Type
  readonly sourceFile: SourceFile
}

export interface TextFile {
  readonly project: ProjectSnapshot
  readonly fileName: ProjectRelativePath.Type
  readonly text: string
}

interface NodeQuestion<A> extends Request.Request<A, ProjectSnapshotError> {
  readonly node: Node
}

export interface ProjectSnapshot {
  readonly project: ConfiguredProject.Type
  readonly fileNameOf: (sourceFile: SourceFile) => Option.Option<ProjectRelativePath.Type>
  readonly file: (
    fileName: ProjectRelativePath.Type,
  ) => Effect.Effect<ProjectFile | undefined, ProjectSnapshotError>
  readonly textFile: (
    fileName: ProjectRelativePath.Type,
  ) => Effect.Effect<TextFile | undefined, ProjectSnapshotError>
  readonly files: Effect.Effect<ReadonlyArray<ProjectFile>, ProjectSnapshotError>
  readonly textFiles: Effect.Effect<ReadonlyArray<TextFile>, ProjectSnapshotError>
  readonly symbolNamed: (
    name: string,
    options: { readonly within: ProjectRelativePath.Type },
  ) => Effect.Effect<NativeSymbol, SymbolNotFound | ProjectSnapshotError>
  readonly symbolOf: (node: Node) => Effect.Effect<NativeSymbol | undefined, ProjectSnapshotError>
  readonly canonicalSymbol: (
    symbol: NativeSymbol,
  ) => Effect.Effect<NativeSymbol, ProjectSnapshotError>
  readonly declarationsOf: (
    symbol: NativeSymbol,
  ) => Effect.Effect<ReadonlyArray<Node>, ProjectSnapshotError>
  readonly referencesTo: (node: Node) => Effect.Effect<ReadonlyArray<Node>, ProjectSnapshotError>
  readonly typeOf: (node: Node) => Effect.Effect<NativeType | undefined, ProjectSnapshotError>
  readonly typeOfSymbol: (
    symbol: NativeSymbol,
  ) => Effect.Effect<NativeType | undefined, ProjectSnapshotError>
  readonly contextualTypeOf: (
    expression: Expression,
  ) => Effect.Effect<NativeType | undefined, ProjectSnapshotError>
  readonly unionMembersOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<NativeType>, ProjectSnapshotError>
  readonly typeArgumentsOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<NativeType>, ProjectSnapshotError>
  readonly propertyOf: (
    type: NativeType,
    name: string,
  ) => Effect.Effect<NativeSymbol | undefined, ProjectSnapshotError>
  readonly propertiesOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<NativeSymbol>, ProjectSnapshotError>
  readonly callSignaturesOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<NativeSignature>, ProjectSnapshotError>
  readonly signatureOf: (
    declaration: Node,
  ) => Effect.Effect<NativeSignature | undefined, ProjectSnapshotError>
  readonly resolvedSignature: (
    call: CallExpression,
  ) => Effect.Effect<NativeSignature | undefined, ProjectSnapshotError>
  readonly signatureDeclaration: (
    signature: NativeSignature,
  ) => Effect.Effect<Node | undefined, ProjectSnapshotError>
  readonly parameterTypesOf: (
    signature: NativeSignature,
  ) => Effect.Effect<ReadonlyArray<NativeType | undefined>, ProjectSnapshotError>
  readonly returnTypeOf: (
    signature: NativeSignature,
  ) => Effect.Effect<NativeType | undefined, ProjectSnapshotError>
  readonly typeToString: (type: NativeType) => Effect.Effect<string, ProjectSnapshotError>
  readonly isTypeAssignableTo: (
    source: NativeType,
    target: NativeType,
  ) => Effect.Effect<boolean, ProjectSnapshotError>
  readonly intrinsicType: (
    name: IntrinsicTypeName,
  ) => Effect.Effect<NativeType, ProjectSnapshotError>
  readonly resolvedModule: (
    specifier: Node,
  ) => Effect.Effect<ProjectFile | undefined, ProjectSnapshotError>
  readonly unsafeNative: <A, E, R>(
    use: (project: NativeProject) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SnapshotExpired, R>
}

const anyMeaning =
  SymbolFlags.Value |
  SymbolFlags.Type |
  SymbolFlags.Namespace |
  SymbolFlags.Alias |
  SymbolFlags.ExportValue

const decodePath = Schema.decodeOption(ProjectRelativePath.schema)

const memoize = <Key, A extends object>(load: (key: Key) => A): ((key: Key) => A) => {
  const known = new Map<Key, A>()
  return (key) => {
    const found = known.get(key)
    if (found !== undefined) return found
    const loaded = load(key)
    known.set(key, loaded)
    return loaded
  }
}

export const make = (options: {
  readonly configured: ConfiguredProject.Type
  readonly native: NativeProject
  readonly workspaceRoot: string
  readonly projectRoot: string
  readonly ensureActive: Effect.Effect<void, SnapshotExpired>
}): ProjectSnapshot => {
  const { configured, native, workspaceRoot, projectRoot, ensureActive } = options
  const { program, checker } = native

  const request = <A>(operation: string, evaluate: () => PromiseLike<A>) =>
    Effect.andThen(ensureActive, nativeRequest(operation, evaluate))

  const absolute = (fileName: ProjectRelativePath.Type): string =>
    fileName.startsWith("../")
      ? Path.join(workspaceRoot, fileName.slice(3))
      : Path.join(projectRoot, fileName)

  const relative = (absoluteName: string): Option.Option<ProjectRelativePath.Type> => {
    const projectRelative = Path.relative(projectRoot, absoluteName)
    if (!projectRelative.startsWith(`..${Path.sep}`)) return decodePath(projectRelative)
    const workspaceRelative = Path.relative(workspaceRoot, absoluteName)
    if (workspaceRelative.startsWith(`..${Path.sep}`)) return Option.none()
    const fileName = ProjectRelativePath.decodeWorkspaceFile(Path.join("..", workspaceRelative))
    return fileName === undefined ? Option.none() : Option.some(fileName)
  }

  const ownedFileOf = memoize(async (absoluteName: string): Promise<ProjectFile | undefined> => {
    const fileName = Option.getOrUndefined(relative(absoluteName))
    const sourceFile = await program.getSourceFile(absoluteName)
    if (fileName === undefined || sourceFile === undefined) return undefined
    const [isDefaultLibrary, isExternal] = await Promise.all([
      program.isSourceFileDefaultLibrary(sourceFile),
      program.isSourceFileFromExternalLibrary(sourceFile),
    ])
    return isDefaultLibrary || isExternal ? undefined : { project, fileName, sourceFile }
  })

  const ownedFile = (absoluteName: string) =>
    request("getSourceFile", () => ownedFileOf(absoluteName))

  const ownedNodes = async (handles: ReadonlyArray<NodeHandle>): Promise<ReadonlyArray<Node>> => {
    const nodes = await Promise.all(handles.map((handle) => handle.resolve(native)))
    const owned = await Promise.all(
      nodes.map(async (node) =>
        node !== undefined && (await ownedFileOf(node.getSourceFile().fileName)) !== undefined
          ? node
          : undefined,
      ),
    )
    return owned.filter((node) => node !== undefined)
  }

  const canonicalSymbolOf = memoize((symbol: NativeSymbol) =>
    (symbol.flags & SymbolFlags.Alias) === 0
      ? symbol.getExportSymbol()
      : checker.getAliasedSymbol(symbol),
  )

  const intrinsicTypeOf = memoize((name: IntrinsicTypeName) =>
    checker[intrinsicTypeGetters[name]](),
  )

  const assignableTo = memoize((target: NativeType) =>
    memoize((source: NativeType) => checker.isTypeAssignableTo(source, target)),
  )

  const perNode = <A>(
    operation: string,
    ask: (nodes: ReadonlyArray<Node>) => PromiseLike<ReadonlyArray<A>>,
  ): ((node: Node) => Effect.Effect<A, ProjectSnapshotError>) => {
    const question = Request.of<NodeQuestion<A>>()
    const resolver = RequestResolver.makeGrouped<NodeQuestion<A>, string>({
      key: (entry) => entry.request.node.getSourceFile().fileName,
      resolver: (entries) =>
        Effect.map(
          request(operation, () => ask(entries.map((entry) => entry.request.node))),
          (answers) =>
            entries.forEach((entry, index) =>
              entry.completeUnsafe(Exit.succeed(answers[index] as A)),
            ),
        ),
    })
    return (node) => Effect.request(question({ node }), resolver)
  }

  const files = request("getSourceFileNames", () => program.getSourceFileNames()).pipe(
    Effect.flatMap((names) => Effect.forEach(names, ownedFile, { concurrency: 8 })),
    Effect.map((files) => files.filter((file) => file !== undefined)),
  )

  const project: ProjectSnapshot = {
    project: configured,

    fileNameOf: (sourceFile) => relative(sourceFile.fileName),

    file: (fileName) => ownedFile(absolute(fileName)),

    textFile: (fileName) =>
      Effect.map(ownedFile(absolute(fileName)), (file) =>
        file === undefined ? undefined : { project, fileName, text: file.sourceFile.text },
      ),

    files,

    textFiles: files.pipe(
      Effect.map((files) =>
        files.map((file) => ({ project, fileName: file.fileName, text: file.sourceFile.text })),
      ),
    ),

    symbolNamed: (name, { within }) =>
      Effect.gen(function* () {
        const file = yield* project.file(within)
        const symbol =
          file === undefined
            ? undefined
            : yield* request("resolveName", async () => {
                const local = await checker.resolveName(name, anyMeaning, file.sourceFile)
                if (local !== undefined) return local
                const [module] = await checker.getSymbolAtLocation([file.sourceFile])
                return module === undefined
                  ? undefined
                  : checker.getMemberInModuleExports(module, name)
              })
        if (symbol === undefined) return yield* new SymbolNotFound({ name, fileName: within })
        return yield* project.canonicalSymbol(symbol)
      }),

    symbolOf: perNode("getSymbolAtLocation", (nodes) => checker.getSymbolAtLocation(nodes)),

    canonicalSymbol: (symbol) => request("getCanonicalSymbol", () => canonicalSymbolOf(symbol)),

    declarationsOf: (symbol) =>
      request("resolveDeclarations", () => ownedNodes(symbol.declarations)),

    referencesTo: (node) =>
      request("getReferencedSymbolsForNode", async () => {
        const entries = await checker.getReferencedSymbolsForNode(
          node,
          node.getStart(node.getSourceFile()),
        )
        return ownedNodes(entries.flatMap((entry) => entry.references))
      }),

    typeOf: perNode("getTypeAtLocation", (nodes) => checker.getTypeAtLocation(nodes)),

    typeOfSymbol: (symbol) => request("getTypeOfSymbol", () => checker.getTypeOfSymbol(symbol)),

    contextualTypeOf: (expression) =>
      request("getContextualType", () => checker.getContextualType(expression)),

    unionMembersOf: (type) =>
      type.isUnionType()
        ? request("getTypes", () => type.getTypes())
        : Effect.as(ensureActive, [type]),

    typeArgumentsOf: (type) =>
      type.isTypeReference()
        ? request("getTypeArguments", () => checker.getTypeArguments(type))
        : Effect.as(ensureActive, []),

    propertyOf: (type, name) =>
      request("getPropertyOfType", () => checker.getPropertyOfType(type, name)),

    propertiesOf: (type) => request("getPropertiesOfType", () => checker.getPropertiesOfType(type)),

    callSignaturesOf: (type) =>
      request("getSignaturesOfType", () => checker.getSignaturesOfType(type, SignatureKind.Call)),

    signatureOf: (declaration) =>
      request("getSignatureFromDeclaration", () =>
        checker.getSignatureFromDeclaration(declaration),
      ),

    resolvedSignature: (call) =>
      request("getResolvedSignature", () => checker.getResolvedSignature(call)),

    signatureDeclaration: (signature) =>
      request("resolveSignatureDeclaration", async () =>
        signature.declaration === undefined ? undefined : signature.declaration.resolve(native),
      ),

    parameterTypesOf: (signature) =>
      request("getParameterType", () =>
        Promise.all(
          signature.parameters.map((_, index) => checker.getParameterType(signature, index)),
        ),
      ),

    returnTypeOf: (signature) =>
      request("getReturnTypeOfSignature", () => checker.getReturnTypeOfSignature(signature)),

    typeToString: (type) => request("typeToString", () => checker.typeToString(type)),

    isTypeAssignableTo: (source, target) =>
      request("isTypeAssignableTo", () => assignableTo(target)(source)),

    intrinsicType: (name) => request("getIntrinsicType", () => intrinsicTypeOf(name)),

    resolvedModule: (specifier) =>
      Effect.gen(function* () {
        const symbol = yield* project.symbolOf(specifier)
        if (symbol === undefined) return undefined
        const canonical = yield* project.canonicalSymbol(symbol)
        const handle = canonical.valueDeclaration ?? canonical.declarations[0]
        if (handle === undefined) return undefined
        const declaration = yield* request("resolveModuleDeclaration", () => handle.resolve(native))
        return declaration === undefined
          ? undefined
          : yield* ownedFile(declaration.getSourceFile().fileName)
      }),

    unsafeNative: (use) =>
      Effect.andThen(
        ensureActive,
        Effect.suspend(() => use(native)),
      ),
  }

  return project
}
