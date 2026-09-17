import { Data, Effect, FileSystem, Schema } from "effect"
import type { Draft } from "./Draft.ts"
import * as FileRef from "./FileRef.ts"
import {
  type FileOperation,
  finalizePlan,
  type InvalidPlan,
  type PlanPolicies,
  type SourceFingerprint,
  type TransformationPlan,
} from "./Plan.ts"
import * as ProjectRelativePath from "./ProjectRelativePath.ts"
import * as Sha256 from "./Sha256.ts"
import {
  type OverlappingProjectOwnership,
  type ProjectNotInSnapshot,
  type ProjectSnapshotError,
  Workspace,
  WorkspaceSnapshot,
} from "./Workspace/index.ts"

export interface Recipe<Input = undefined, E = never, R = never> {
  readonly name: string
  readonly version: string
  readonly policies: PlanPolicies
  readonly schema: Schema.Codec<Input, unknown> | undefined
  readonly run: (input: Input) => Effect.Effect<Draft, E, R | WorkspaceSnapshot>
}

export class RecipeInputError extends Data.TaggedError("RecipeInputError")<{
  readonly recipe: string
  readonly cause: unknown
}> {}

export const define = <Input = undefined, E = never, R = never>(
  name: string,
  definition: {
    readonly version: string
    readonly schema?: Schema.Codec<Input, unknown>
    readonly policies?: Partial<PlanPolicies>
    readonly run: (input: Input) => Effect.Effect<Draft, E, R | WorkspaceSnapshot>
  },
): Recipe<Input, E, R> => ({
  name,
  version: definition.version,
  schema: definition.schema,
  policies: {
    diagnostics: "no-new-errors",
    idempotence: "not-promised",
    ...definition.policies,
  },
  run: definition.run,
})

export const encodeInput = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<Schema.Json, RecipeInputError> =>
  Effect.gen(function* () {
    const encoded =
      recipe.schema === undefined ? input : yield* Schema.encodeUnknownEffect(recipe.schema)(input)
    return yield* Schema.decodeUnknownEffect(Schema.Json)(encoded ?? null)
  }).pipe(Effect.mapError((cause) => new RecipeInputError({ recipe: recipe.name, cause })))

const fingerprint = (file: FileRef.FileRef, content: string | undefined): SourceFingerprint =>
  content === undefined
    ? { ...file, kind: "missing" }
    : { ...file, kind: "file", hash: Sha256.digest(content) }

const fingerprintSources = (fileOperations: ReadonlyArray<FileOperation>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const workspace = yield* Workspace
    const snapshot = yield* WorkspaceSnapshot
    const sources = new Map<string, SourceFingerprint>()
    const record = (file: FileRef.FileRef, content: string | undefined) =>
      sources.set(FileRef.key(file), fingerprint(file, content))

    for (const project of snapshot.projects) {
      const configured = project.project
      const config = {
        projectId: configured.id,
        fileName: ProjectRelativePath.schema.make(configured.config.split("/").at(-1)!),
      }
      const configText = yield* fs
        .readFileString(workspace.absolutePath(config))
        .pipe(Effect.orElseSucceed(() => undefined))
      record(config, configText)
      for (const file of yield* project.files) {
        record({ projectId: configured.id, fileName: file.fileName }, file.sourceFile.text)
      }
    }
    for (const operation of fileOperations) {
      const target = {
        projectId: operation.projectId,
        fileName: operation.kind === "move" ? operation.toFileName : operation.fileName,
      }
      if (operation.kind !== "delete" && !sources.has(FileRef.key(target))) {
        const onDisk = yield* fs
          .readFileString(workspace.absolutePath(target))
          .pipe(Effect.orElseSucceed(() => undefined))
        record(target, onDisk)
      }
    }
    return [...sources.values()]
  })

export const run = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<
  TransformationPlan,
  E | RecipeInputError | InvalidPlan | ProjectSnapshotError | ProjectNotInSnapshot | OverlappingProjectOwnership,
  Workspace | FileSystem.FileSystem | Exclude<R, WorkspaceSnapshot>
> =>
  Effect.gen(function* () {
    const options = yield* encodeInput(recipe, input)
    const workspace = yield* Workspace
    return yield* workspace.withSnapshot(
      Effect.gen(function* () {
        const snapshot = yield* WorkspaceSnapshot
        const draft = yield* recipe.run(input)
        return yield* finalizePlan({
          recipe: { name: recipe.name, version: recipe.version, options },
          projects: snapshot.projects.map(({ project: { id, config } }) => ({
            id,
            configFileName: config,
          })),
          sources: yield* fingerprintSources(draft.fileOperations),
          edits: draft.edits,
          fileOperations: draft.fileOperations,
          policies: recipe.policies,
        })
      }),
    )
  })
