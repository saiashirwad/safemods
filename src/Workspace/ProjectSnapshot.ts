import * as Path from "node:path"
import { Data, Effect, Option, Schema } from "effect"
import type { SourceFile } from "typescript/unstable/ast"
import {
  SymbolFlags,
  type Project as NativeProject,
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

export interface ProjectSnapshot {
  readonly project: ConfiguredProject.Type
  readonly fileNameOf: (sourceFile: SourceFile) => ProjectRelativePath.Type
  readonly file: (
    fileName: ProjectRelativePath.Type,
  ) => Effect.Effect<ProjectFile | undefined, ProjectSnapshotError>
  readonly files: Effect.Effect<ReadonlyArray<ProjectFile>, ProjectSnapshotError>
  readonly symbolNamed: (
    name: string,
    options: { readonly within: ProjectRelativePath.Type },
  ) => Effect.Effect<NativeSymbol, SymbolNotFound | ProjectSnapshotError>
  readonly symbolsAt: (
    fileName: ProjectRelativePath.Type,
    positions: ReadonlyArray<number>,
  ) => Effect.Effect<ReadonlyArray<NativeSymbol | undefined>, ProjectSnapshotError>
  readonly canonicalSymbol: (
    symbol: NativeSymbol,
  ) => Effect.Effect<NativeSymbol, ProjectSnapshotError>
  readonly typesAt: (
    fileName: ProjectRelativePath.Type,
    positions: ReadonlyArray<number>,
  ) => Effect.Effect<ReadonlyArray<NativeType | undefined>, ProjectSnapshotError>
  readonly typeToString: (type: NativeType) => Effect.Effect<string, ProjectSnapshotError>
  readonly isTypeAssignableTo: (
    source: NativeType,
    target: NativeType,
  ) => Effect.Effect<boolean, ProjectSnapshotError>
  readonly intrinsicType: (
    name: IntrinsicTypeName,
  ) => Effect.Effect<NativeType, ProjectSnapshotError>
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

export const make = (options: {
  readonly configured: ConfiguredProject.Type
  readonly native: NativeProject
  readonly projectRoot: string
  readonly ensureActive: Effect.Effect<void, SnapshotExpired>
}): ProjectSnapshot => {
  const { configured, native, projectRoot, ensureActive } = options
  const { program, checker } = native

  const request = <A>(operation: string, evaluate: () => PromiseLike<A>) =>
    Effect.andThen(ensureActive, nativeRequest(operation, evaluate))

  const absolute = (fileName: ProjectRelativePath.Type): string => Path.join(projectRoot, fileName)

  const relative = (absoluteName: string): Option.Option<ProjectRelativePath.Type> =>
    decodePath(Path.relative(projectRoot, absoluteName))

  const ownedFile = (absoluteName: string) =>
    request("getSourceFile", async (): Promise<ProjectFile | undefined> => {
      const fileName = Option.getOrUndefined(relative(absoluteName))
      const sourceFile = await program.getSourceFile(absoluteName)
      if (fileName === undefined || sourceFile === undefined) return undefined
      const [isDefaultLibrary, isExternal] = await Promise.all([
        program.isSourceFileDefaultLibrary(sourceFile),
        program.isSourceFileFromExternalLibrary(sourceFile),
      ])
      return isDefaultLibrary || isExternal ? undefined : { project, fileName, sourceFile }
    })

  const canonicalSymbolOf = (symbol: NativeSymbol): Promise<NativeSymbol> =>
    (symbol.flags & SymbolFlags.Alias) === 0
      ? symbol.getExportSymbol()
      : checker.getAliasedSymbol(symbol)

  const project: ProjectSnapshot = {
    project: configured,

    fileNameOf: (sourceFile) => Option.getOrThrow(relative(sourceFile.fileName)),

    file: (fileName) => ownedFile(absolute(fileName)),

    files: request("getSourceFileNames", () => program.getSourceFileNames()).pipe(
      Effect.flatMap((names) => Effect.forEach(names, ownedFile, { concurrency: 8 })),
      Effect.map((files) => files.filter((file) => file !== undefined)),
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

    symbolsAt: (fileName, positions) =>
      positions.length === 0
        ? Effect.as(ensureActive, [])
        : request("getSymbolAtPosition", () =>
            checker.getSymbolAtPosition(absolute(fileName), positions),
          ),

    canonicalSymbol: (symbol) => request("getCanonicalSymbol", () => canonicalSymbolOf(symbol)),

    typesAt: (fileName, positions) =>
      positions.length === 0
        ? Effect.as(ensureActive, [])
        : request("getTypeAtPosition", () =>
            checker.getTypeAtPosition(absolute(fileName), positions),
          ),

    typeToString: (type) => request("typeToString", () => checker.typeToString(type)),

    isTypeAssignableTo: (source, target) =>
      request("isTypeAssignableTo", () => checker.isTypeAssignableTo(source, target)),

    intrinsicType: (name) =>
      request("getIntrinsicType", () => checker[intrinsicTypeGetters[name]]()),

    unsafeNative: (use) =>
      Effect.andThen(
        ensureActive,
        Effect.suspend(() => use(native)),
      ),
  }

  return project
}
