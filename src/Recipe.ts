/** Recipes: definition, input validation, workspace fingerprinting, and planning. */
import { Data, Effect, FileSystem, Path, Schema } from "effect"
import type { Draft } from "./Draft/index.ts"
import {
  compareSourceFingerprints,
  finalizePlan,
  type PlanBuildError,
  type PlanPolicies,
  type SourceFingerprint,
  type TransformationPlan,
} from "./Plan/index.ts"
import {
  type ProjectNotInSnapshot,
  type SnapshotExpired,
  type SnapshotTransition,
  Workspace,
  type WorkspaceCompilerError,
  WorkspaceSnapshot,
  type WorkspaceSnapshotService,
} from "./Workspace/index.ts"
import { type DraftEvidenceConflict, finalizeDraftEvidence, type Json } from "./Evidence.ts"
import { sha256 } from "./Edit.ts"
import {
  all as allPolicies,
  type CompiledPolicy,
  type Policy,
  type VerificationRule,
} from "./Policy.ts"
import {
  parseProjectRelativePath,
  projectRelative,
  type ProjectRelativePath,
} from "./ProjectPath.ts"

/**
 * A reusable transformation. The recipe body runs in a Workspace Snapshot
 * region and returns a Draft. It does not finalize or write the change.
 */
export interface Recipe<Input = undefined, E = never, R = never> {
  readonly name: string
  readonly version: string
  readonly implementationHash: string
  readonly policies: PlanPolicies
  readonly rules: ReadonlyArray<VerificationRule>
  readonly schema?: Schema.Codec<Input, unknown> | undefined
  readonly run: (input: Input) => Effect.Effect<Draft, E, R | WorkspaceSnapshot | Workspace>
}

interface RecipeDefinition<Input, E, R> {
  readonly version: string
  readonly schema?: Schema.Codec<Input, unknown>
  /** Digest supplied by release tooling. The development default uses name and version. */
  readonly implementationHash?: string
  readonly policies?: ReadonlyArray<Policy>
  readonly run: (input: Input) => Effect.Effect<Draft, E, R | WorkspaceSnapshot | Workspace>
}

export class RecipeInputError extends Data.TaggedError("RecipeInputError")<{
  readonly recipe: string
  readonly cause: unknown
}> {}

interface ValidatedRecipeInput<Input> {
  readonly value: Input
  readonly encoded: Json
}

/** Validate recipe input and encode the exact durable plan options. */
export const validateRecipeInput = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<ValidatedRecipeInput<Input>, RecipeInputError> =>
  Effect.gen(function* () {
    const schema = recipe.schema
    const candidate = input ?? null
    if (schema === undefined) {
      const encoded = yield* Schema.decodeUnknownEffect(Schema.Json)(candidate)
      return { value: input, encoded }
    }

    const value = yield* Schema.decodeUnknownEffect(schema)(input)
    const candidateEncoded = yield* Schema.encodeUnknownEffect(schema)(value)
    const encoded = yield* Schema.decodeUnknownEffect(Schema.Json)(candidateEncoded ?? null)
    return { value, encoded }
  }).pipe(Effect.mapError((cause) => new RecipeInputError({ recipe: recipe.name, cause })))

/** Construct a recipe from durable policies and runtime rules. */
const fromCompiled = <Input, E, R>(
  name: string,
  version: string,
  compiled: CompiledPolicy,
  run: Recipe<Input, E, R>["run"],
  options: {
    readonly schema?: Recipe<Input>["schema"]
    readonly implementationHash?: string | undefined
  } = {},
): Recipe<Input, E, R> =>
  Object.freeze({
    name,
    version,
    schema: options.schema,
    implementationHash: options.implementationHash ?? sha256(`${name}@${version}`),
    policies: compiled.policy,
    rules: compiled.rules,
    run,
  })

export const define = <Input = undefined, E = never, R = never>(
  name: string,
  definition: RecipeDefinition<Input, E, R>,
): Recipe<Input, E, R> => {
  const compiled = allPolicies(definition.policies ?? [])
  return fromCompiled(name, definition.version, compiled, definition.run, {
    schema: definition.schema,
    implementationHash: definition.implementationHash,
  })
}

const observationRelativePath = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  projectRoot: string,
  absolute: string,
): Effect.Effect<ProjectRelativePath | undefined> =>
  Effect.gen(function* () {
    const direct = parseProjectRelativePath(projectRelative(path, projectRoot, absolute))
    if (direct !== undefined) return direct

    const realRoot = yield* fs.realPath(projectRoot).pipe(Effect.orElseSucceed(() => undefined))
    if (realRoot === undefined) return undefined
    const realAbsolute = yield* fs.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute))
    return parseProjectRelativePath(projectRelative(path, realRoot, realAbsolute))
  })

const fingerprintKey = (source: SourceFingerprint): string =>
  `${source.projectId}\0${source.kind ?? "file"}\0${source.fileName}`

const addFingerprint = (
  sources: Map<string, SourceFingerprint>,
  source: SourceFingerprint,
): void => {
  const relative = parseProjectRelativePath(source.fileName)
  if (relative === undefined) return
  const next = { ...source, fileName: relative }
  sources.set(fingerprintKey(next), next)
}

/** Record compiler inputs that verification can revalidate. */
const fingerprintWorkspace = (
  workspaceRoot: string,
  snapshot: WorkspaceSnapshotService,
): Effect.Effect<
  ReadonlyArray<SourceFingerprint>,
  WorkspaceCompilerError | ProjectNotInSnapshot | SnapshotExpired,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const sources = new Map<string, SourceFingerprint>()
    for (const configured of snapshot.projects) {
      const project = yield* snapshot.project(configured)
      const owned = (yield* project.sourceFileNames).filter(
        (fileName) =>
          parseProjectRelativePath(projectRelative(path, project.root, fileName)) !== undefined,
      )
      const files = [...new Set(owned)].sort()
      const configFileName = path.resolve(workspaceRoot, configured.config)
      const contentFiles = [configFileName, ...files]

      for (const absolute of contentFiles) {
        const relative = yield* observationRelativePath(fs, path, project.root, absolute)
        if (relative === undefined) continue
        const content = yield* fs
          .readFileString(absolute, "utf8")
          .pipe(Effect.orElseSucceed(() => undefined))
        if (content === undefined) {
          addFingerprint(sources, {
            projectId: configured.id,
            fileName: relative,
            hash: "",
            kind: "missing",
          })
        } else {
          addFingerprint(sources, {
            projectId: configured.id,
            fileName: relative,
            hash: sha256(content),
          })
        }
      }
    }
    return [...sources.values()].sort(compareSourceFingerprints)
  })

/** Toolchain identity recorded in each Plan. */
export const TOOLCHAIN = {
  systemVersion: "0.2.0",
  typescriptVersion: "7.0.2",
  effectVersion: "4.0.0-rc.109",
} as const

/** Run a recipe through planning. This operation does not write project files. */
export const run = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
  transition: SnapshotTransition = {},
): Effect.Effect<
  TransformationPlan,
  | E
  | RecipeInputError
  | PlanBuildError
  | WorkspaceCompilerError
  | ProjectNotInSnapshot
  | SnapshotExpired
  | DraftEvidenceConflict,
  Workspace | FileSystem.FileSystem | Path.Path | Exclude<R, WorkspaceSnapshot>
> =>
  Effect.gen(function* () {
    const validatedInput = yield* validateRecipeInput(recipe, input)
    const workspace = yield* Workspace
    return yield* workspace.withSnapshot(
      transition,
      Effect.gen(function* () {
        const snapshot = yield* WorkspaceSnapshot
        const draft = yield* recipe.run(validatedInput.value)
        const completeDraft = yield* finalizeDraftEvidence(draft)
        const sources = yield* fingerprintWorkspace(workspace.root, snapshot)

        const planInput = {
          recipe: {
            name: recipe.name,
            version: recipe.version,
            implementationHash: recipe.implementationHash,
            options: validatedInput.encoded,
          },
          toolchain: TOOLCHAIN,
          projects: snapshot.projects.map((configured) => ({
            id: configured.id,
            configFileName: configured.config,
          })),
          sources,
          edits: completeDraft.edits,
          evidence: completeDraft.evidence,
          policies: recipe.policies,
          measurements: { matches: completeDraft.matches },
        }
        const finalizedInput =
          completeDraft.fileOperations !== undefined
            ? { ...planInput, fileOperations: completeDraft.fileOperations }
            : planInput

        return yield* finalizePlan(finalizedInput)
      }),
    )
  })
