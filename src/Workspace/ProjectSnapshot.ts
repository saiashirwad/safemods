import {
  Data,
  Effect,
  Exit,
  Option,
  Order,
  type Path,
  Request,
  RequestResolver,
  Schema,
} from "effect"
import type { CallExpression, Expression, Node, SourceFile } from "typescript/unstable/ast"
import {
  type IndexInfo,
  NodeBuilderFlags,
  type NodeHandle,
  SignatureKind,
  SymbolFlags,
  TypeFlags,
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

export interface ModuleExport {
  readonly name: string
  readonly symbol: NativeSymbol
}

export interface DeclarationSite {
  readonly path: string
  readonly fileName: ProjectRelativePath.Type | undefined
}

interface FileInfo {
  readonly sourceFile: SourceFile
  readonly fileName: ProjectRelativePath.Type | undefined
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
  readonly exportsOf: (
    module: ProjectFile | NativeSymbol,
  ) => Effect.Effect<ReadonlyArray<ModuleExport>, ProjectSnapshotError>
  readonly symbolOf: (node: Node) => Effect.Effect<NativeSymbol | undefined, ProjectSnapshotError>
  readonly canonicalSymbol: (
    symbol: NativeSymbol,
  ) => Effect.Effect<NativeSymbol, ProjectSnapshotError>
  readonly declarationsOf: (
    symbol: NativeSymbol,
  ) => Effect.Effect<ReadonlyArray<Node>, ProjectSnapshotError>
  readonly declaredIn: (
    symbol: NativeSymbol,
  ) => Effect.Effect<ReadonlyArray<DeclarationSite>, ProjectSnapshotError>
  readonly referencesTo: (node: Node) => Effect.Effect<ReadonlyArray<Node>, ProjectSnapshotError>
  readonly typeOf: (node: Node) => Effect.Effect<NativeType | undefined, ProjectSnapshotError>
  readonly typeOfSymbol: (
    symbol: NativeSymbol,
  ) => Effect.Effect<NativeType | undefined, ProjectSnapshotError>
  readonly declaredTypeOfSymbol: (
    symbol: NativeSymbol,
  ) => Effect.Effect<NativeType, ProjectSnapshotError>
  readonly symbolOfType: (
    type: NativeType,
  ) => Effect.Effect<NativeSymbol | undefined, ProjectSnapshotError>
  readonly contextualTypeOf: (
    expression: Expression,
  ) => Effect.Effect<NativeType | undefined, ProjectSnapshotError>
  readonly unionMembersOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<NativeType>, ProjectSnapshotError>
  readonly intersectionMembersOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<NativeType>, ProjectSnapshotError>
  readonly typeArgumentsOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<NativeType>, ProjectSnapshotError>
  readonly aliasTypeArgumentsOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<NativeType>, ProjectSnapshotError>
  readonly genericTargetOf: (
    type: NativeType,
  ) => Effect.Effect<NativeType | undefined, ProjectSnapshotError>
  readonly constraintOf: (
    type: NativeType,
  ) => Effect.Effect<NativeType | undefined, ProjectSnapshotError>
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
  readonly constructSignaturesOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<NativeSignature>, ProjectSnapshotError>
  readonly indexInfosOf: (
    type: NativeType,
  ) => Effect.Effect<ReadonlyArray<IndexInfo>, ProjectSnapshotError>
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
  readonly typeToString: (
    type: NativeType,
    options?: { readonly expandAliases: boolean },
  ) => Effect.Effect<string, ProjectSnapshotError>
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

const anyMeaning = SymbolFlags.Value |
  SymbolFlags.Type |
  SymbolFlags.Namespace |
  SymbolFlags.Alias |
  SymbolFlags.ExportValue

const decodePath = Schema.decodeOption(ProjectRelativePath.schema)

const memoize = <Key, A extends object>(load: (key: Key) => A): (key: Key) => A => {
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
  readonly path: Path.Path
  readonly workspaceRoot: string
  readonly projectRoot: string
  readonly ensureActive: Effect.Effect<void, SnapshotExpired>
}): ProjectSnapshot => {
  const { configured, native, path, workspaceRoot, projectRoot, ensureActive } = options
  const { program, checker } = native

  const request = <A>(operation: string, evaluate: () => PromiseLike<A>) =>
    Effect.andThen(ensureActive, nativeRequest(operation, evaluate))

  const absolute = (fileName: ProjectRelativePath.Type): string =>
    fileName.startsWith("../") ?
      path.join(workspaceRoot, fileName.slice(3)) :
      path.join(projectRoot, fileName)

  const relative = (absoluteName: string): Option.Option<ProjectRelativePath.Type> => {
    const projectRelative = path.relative(projectRoot, absoluteName)
    if (!projectRelative.startsWith(`..${path.sep}`)) return decodePath(projectRelative)
    const workspaceRelative = path.relative(workspaceRoot, absoluteName)
    if (workspaceRelative.startsWith(`..${path.sep}`)) return Option.none()
    const fileName = ProjectRelativePath.decodeWorkspaceFile(path.join("..", workspaceRelative))
    return fileName === undefined ? Option.none() : Option.some(fileName)
  }

  const fileInfoOf = memoize(async (absoluteName: string): Promise<FileInfo | undefined> => {
    const sourceFile = await program.getSourceFile(absoluteName)
    if (sourceFile === undefined) return undefined
    const [defaultLibrary, external] = await Promise.all([
      program.isSourceFileDefaultLibrary(sourceFile),
      program.isSourceFileFromExternalLibrary(sourceFile),
    ])
    const fileName = defaultLibrary || external ?
      undefined :
      Option.getOrUndefined(relative(sourceFile.fileName))
    return { sourceFile, fileName }
  })

  const projectFileOf = memoize(async (absoluteName: string): Promise<ProjectFile | undefined> => {
    const info = await fileInfoOf(absoluteName)
    return info === undefined || info.fileName === undefined ?
      undefined :
      { project, fileName: info.fileName, sourceFile: info.sourceFile }
  })

  const ownedFile = (absoluteName: string) =>
    request("getSourceFile", () => projectFileOf(absoluteName))

  const ownedNodes = async (handles: ReadonlyArray<NodeHandle>): Promise<ReadonlyArray<Node>> => {
    const nodes = await Promise.all(handles.map((handle) => handle.resolve(native)))
    const owned = await Promise.all(
      nodes.map(async (node) =>
        node !== undefined && (await projectFileOf(node.getSourceFile().fileName)) !== undefined ?
          node :
          undefined
      ),
    )
    return owned.filter((node) => node !== undefined)
  }

  const canonicalSymbolOf = memoize((symbol: NativeSymbol) =>
    (symbol.flags & SymbolFlags.Alias) === 0 ?
      symbol.getExportSymbol() :
      checker.getAliasedSymbol(symbol)
  )

  const intrinsicTypeOf = memoize((name: IntrinsicTypeName) =>
    checker[intrinsicTypeGetters[name]]()
  )

  const assignableTo = memoize((target: NativeType) =>
    memoize((source: NativeType) => checker.isTypeAssignableTo(source, target))
  )

  const perNode = <A>(
    operation: string,
    ask: (nodes: ReadonlyArray<Node>) => PromiseLike<ReadonlyArray<A>>,
  ): (node: Node) => Effect.Effect<A, ProjectSnapshotError> => {
    const question = Request.of<NodeQuestion<A>>()
    const resolver = RequestResolver.makeGrouped<NodeQuestion<A>, string>({
      key: (entry) => entry.request.node.getSourceFile().fileName,
      resolver: (entries) =>
        Effect.map(
          request(operation, () => ask(entries.map((entry) => entry.request.node))),
          (answers) =>
            entries.forEach((entry, index) =>
              entry.completeUnsafe(Exit.succeed(answers[index] as A))
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
      Effect.map(
        ownedFile(absolute(fileName)),
        (file) =>
          file === undefined ? undefined : { project, fileName, text: file.sourceFile.text },
      ),

    files,

    textFiles: files.pipe(
      Effect.map((files) =>
        files.map((file) => ({ project, fileName: file.fileName, text: file.sourceFile.text }))
      ),
    ),

    symbolNamed: (name, { within }) =>
      Effect.gen(function* () {
        const file = yield* project.file(within)
        const symbol = file === undefined ?
          undefined :
          yield* request("resolveName", async () => {
            const local = await checker.resolveName(name, anyMeaning, file.sourceFile)
            if (local !== undefined) return local
            const [module] = await checker.getSymbolAtLocation([file.sourceFile])
            return module === undefined ?
              undefined :
              checker.getMemberInModuleExports(module, name)
          })
        if (symbol === undefined) return yield* new SymbolNotFound({ name, fileName: within })
        return yield* project.canonicalSymbol(symbol)
      }),

    exportsOf: (source) =>
      Effect.gen(function* () {
        const exported = yield* request("getExportsOfModule", async () => {
          const module = "sourceFile" in source ?
            (await checker.getSymbolAtLocation([source.sourceFile]))[0] :
            source
          return module === undefined ? [] : checker.getExportsOfModule(module)
        })
        const entries = yield* Effect.forEach(
          exported,
          (symbol) =>
            Effect.map(project.canonicalSymbol(symbol), (canonical) => ({
              name: symbol.name,
              symbol: canonical,
            })),
          { concurrency: "unbounded" },
        )
        return [...entries].sort((left, right) => Order.String(left.name, right.name))
      }),

    symbolOf: perNode("getSymbolAtLocation", (nodes) => checker.getSymbolAtLocation(nodes)),

    canonicalSymbol: (symbol) => request("getCanonicalSymbol", () => canonicalSymbolOf(symbol)),

    declarationsOf: (symbol) =>
      request("resolveDeclarations", () => ownedNodes(symbol.declarations)),

    declaredIn: (symbol) =>
      request("resolveDeclarationSites", () =>
        Promise.all(
          symbol.declarations.map(async (handle) => {
            const info = await fileInfoOf(handle.path)
            return { path: info?.sourceFile.fileName ?? handle.path, fileName: info?.fileName }
          }),
        )),

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

    declaredTypeOfSymbol: (symbol) =>
      request("getDeclaredTypeOfSymbol", () => checker.getDeclaredTypeOfSymbol(symbol)),

    symbolOfType: (type) =>
      request("getSymbolOfType", async () => {
        const [alias, own] = await Promise.all([type.getAliasSymbol(), type.getSymbol()])
        return alias ?? own
      }),

    contextualTypeOf: (expression) =>
      request("getContextualType", () => checker.getContextualType(expression)),

    unionMembersOf: (type) =>
      type.isUnionType() ?
        request("getTypes", () => type.getTypes()) :
        Effect.as(ensureActive, [type]),

    intersectionMembersOf: (type) =>
      type.isIntersectionType() ?
        request("getTypes", () => type.getTypes()) :
        Effect.as(ensureActive, []),

    typeArgumentsOf: (type) =>
      type.isTypeReference() ?
        request("getTypeArguments", () => checker.getTypeArguments(type)) :
        Effect.as(ensureActive, []),

    aliasTypeArgumentsOf: (type) =>
      request("getAliasTypeArguments", () => type.getAliasTypeArguments()),

    genericTargetOf: (type) =>
      type.isTypeReference() ?
        request("getTargetOfType", async () => {
          const target = await type.getTarget()
          return target === type ? undefined : target
        }) :
        Effect.as(ensureActive, undefined),

    constraintOf: (type) =>
      (type.flags & TypeFlags.TypeParameter) === 0 ?
        Effect.as(ensureActive, undefined) :
        request("getBaseConstraintOfType", () => checker.getBaseConstraintOfType(type)),

    propertyOf: (type, name) =>
      request("getPropertyOfType", () => checker.getPropertyOfType(type, name)),

    propertiesOf: (type) => request("getPropertiesOfType", () => checker.getPropertiesOfType(type)),

    callSignaturesOf: (type) =>
      request("getSignaturesOfType", () => checker.getSignaturesOfType(type, SignatureKind.Call)),

    constructSignaturesOf: (type) =>
      request(
        "getSignaturesOfType",
        () => checker.getSignaturesOfType(type, SignatureKind.Construct),
      ),

    indexInfosOf: (type) => request("getIndexInfosOfType", () => checker.getIndexInfosOfType(type)),

    signatureOf: (declaration) =>
      request(
        "getSignatureFromDeclaration",
        () => checker.getSignatureFromDeclaration(declaration),
      ),

    resolvedSignature: (call) =>
      request("getResolvedSignature", () => checker.getResolvedSignature(call)),

    signatureDeclaration: (signature) =>
      request(
        "resolveSignatureDeclaration",
        async () =>
          signature.declaration === undefined ? undefined : signature.declaration.resolve(native),
      ),

    parameterTypesOf: (signature) =>
      request("getParameterType", () =>
        Promise.all(
          signature.parameters.map((_, index) => checker.getParameterType(signature, index)),
        )),

    returnTypeOf: (signature) =>
      request("getReturnTypeOfSignature", () => checker.getReturnTypeOfSignature(signature)),

    typeToString: (type, options) =>
      request("typeToString", () =>
        checker.typeToString(
          type,
          undefined,
          options?.expandAliases === true ?
            NodeBuilderFlags.NoTruncation | NodeBuilderFlags.InTypeAlias :
            NodeBuilderFlags.NoTruncation,
        )),

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
        return declaration === undefined ?
          undefined :
          yield* ownedFile(declaration.getSourceFile().fileName)
      }),

    unsafeNative: (use) =>
      Effect.andThen(
        ensureActive,
        Effect.suspend(() => use(native)),
      ),
  }

  return project
}
