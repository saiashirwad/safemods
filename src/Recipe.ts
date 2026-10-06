import { Data, Effect, Predicate, Schema } from "effect"
import * as Proposal from "./Proposal.ts"
import type { ProjectSnapshot, WorkspaceSnapshot } from "./Workspace/index.ts"

export interface Recipe<Input = undefined, E = never, R = never> {
  readonly name: string
  readonly version: string
  readonly policies: Proposal.Policies
  readonly schema: Schema.Codec<Input, unknown> | undefined
  readonly run: (
    snapshot: WorkspaceSnapshot,
    input: Input,
  ) => Effect.Effect<Proposal.Proposal, E, R>
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
    readonly policies?: Partial<Proposal.Policies>
    readonly run: (
      snapshot: WorkspaceSnapshot,
      input: Input,
    ) => Effect.Effect<Proposal.Proposal, E, R>
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

export const perProject = <Input = undefined, E = never, R = never>(
  name: string,
  definition: {
    readonly version: string
    readonly schema?: Schema.Codec<Input, unknown>
    readonly policies?: Partial<Proposal.Policies>
    readonly run: (project: ProjectSnapshot, input: Input) => Effect.Effect<Proposal.Proposal, E, R>
  },
): Recipe<Input, E, R> =>
  define(name, {
    ...definition,
    run: (snapshot, input) =>
      Effect.map(
        Effect.forEach(snapshot.projects, (project) => definition.run(project, input), {
          concurrency: "unbounded",
        }),
        (proposals) => Proposal.concat(...proposals),
      ),
  })

export const isRecipe = (value: unknown): value is Recipe<unknown> => {
  if (!Predicate.isObject(value)) return false
  const { name, version, policies, schema, run } = value
  if (
    typeof name !== "string" || name.trim() === "" || typeof version !== "string" ||
    version.trim() === ""
  ) return false
  if (typeof run !== "function" || !Predicate.isObject(policies)) return false
  if (schema !== undefined && !Schema.isSchema(schema)) return false
  const { diagnostics, idempotence, maxAffectedFiles } = policies
  return (diagnostics === "no-new-errors" || diagnostics === "allow-new-errors") &&
    (idempotence === "required" || idempotence === "not-promised") &&
    (maxAffectedFiles === undefined ||
      (typeof maxAffectedFiles === "number" && Number.isSafeInteger(maxAffectedFiles) &&
        maxAffectedFiles >= 0))
}

export const checkInput = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<void, RecipeInputError> => {
  if (!isRecipe(recipe)) {
    return new RecipeInputError({
      recipe: recipe.name,
      cause: "Invalid recipe metadata, policies, schema, or run callback",
    })
  }
  return recipe.schema === undefined ?
    Effect.void :
    Schema.encodeUnknownEffect(recipe.schema)(input).pipe(
      Effect.asVoid,
      Effect.mapError((cause) => new RecipeInputError({ recipe: recipe.name, cause })),
    )
}
