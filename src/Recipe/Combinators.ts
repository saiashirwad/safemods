/** Recipe composition and conditional execution. */
import { Effect } from "effect"
import * as Draft from "../Draft/index.ts"
import type { DraftEvidenceConflict } from "../Evidence/index.ts"
import type { EditConflict, InvalidEdit } from "../Edit/index.ts"
import { sha256 } from "../Edit/Hash.ts"
import type { PlanPolicies } from "../Plan/index.ts"
import { composeDraft } from "../Overlay/index.ts"
import * as Policy from "../Policy/index.ts"
import type { VirtualFsError } from "../VirtualFs/index.ts"
import {
  WorkspaceSnapshot,
  type FileNotFound,
  type ProjectNotInSnapshot,
  type SnapshotExpired,
  type WorkspaceCompilerError,
  type WorkspaceSnapshotService,
} from "../Workspace/index.ts"
import { fromCompiled } from "./Define.ts"
import type { Recipe } from "./Recipe.ts"

const composedSchema = <Input>(
  recipes: ReadonlyArray<Recipe<Input, any, any>>,
): Recipe<Input>["schema"] => {
  const schemas = recipes.flatMap((recipe) => (recipe.schema === undefined ? [] : [recipe.schema]))
  const schema = schemas[0]
  if (schema !== undefined && !schemas.every((candidate) => candidate === schema)) {
    throw new TypeError("Composed recipes must use the same input schema")
  }
  return schema
}

const composedIdentity = (
  name: string,
  version: string,
  recipes: ReadonlyArray<Recipe<any, any, any>>,
): string =>
  sha256(`${name}@${version}:${recipes.map((recipe) => recipe.implementationHash).join(",")}`)

type RecipeCompositionError<E> =
  | E
  | EditConflict
  | InvalidEdit
  | FileNotFound
  | WorkspaceCompilerError
  | ProjectNotInSnapshot
  | VirtualFsError
  | SnapshotExpired
  | DraftEvidenceConflict

/** Sequentially compose recipes through in-memory snapshot overlays. */
export function pipe<Input, E1, R1, E2, R2>(
  r1: Recipe<Input, E1, R1>,
  r2: Recipe<Input, E2, R2>,
): Recipe<Input, RecipeCompositionError<E1 | E2>, R1 | R2>
export function pipe<Input, E1, R1, E2, R2, E3, R3>(
  r1: Recipe<Input, E1, R1>,
  r2: Recipe<Input, E2, R2>,
  r3: Recipe<Input, E3, R3>,
): Recipe<Input, RecipeCompositionError<E1 | E2 | E3>, R1 | R2 | R3>
export function pipe<Input, E1, R1, E2, R2, E3, R3, E4, R4>(
  r1: Recipe<Input, E1, R1>,
  r2: Recipe<Input, E2, R2>,
  r3: Recipe<Input, E3, R3>,
  r4: Recipe<Input, E4, R4>,
): Recipe<Input, RecipeCompositionError<E1 | E2 | E3 | E4>, R1 | R2 | R3 | R4>
export function pipe<Input, E, R>(
  ...recipes: ReadonlyArray<Recipe<Input, E, R>>
): Recipe<Input, RecipeCompositionError<E>, R> {
  const name = recipes.map((recipe) => recipe.name).join(" >> ")
  const version = recipes.map((recipe) => recipe.version).join("+")
  const compiled = compileChildren(recipes, "every-child")

  return fromCompiled(
    name,
    version,
    compiled,
    (input: Input) =>
      Effect.gen(function* () {
        let accumulatedDraft = Draft.empty
        for (const recipe of recipes) {
          accumulatedDraft = yield* composeDraft(accumulatedDraft, recipe.run(input))
        }
        return accumulatedDraft
      }),
    {
      schema: composedSchema(recipes),
      implementationHash: composedIdentity(name, version, recipes),
    },
  )
}

/** Run recipes concurrently over one snapshot and merge their Drafts. */
export function all<Input, E1, R1, E2, R2>(
  recipes: readonly [Recipe<Input, E1, R1>, Recipe<Input, E2, R2>],
): Recipe<Input, RecipeCompositionError<E1 | E2>, R1 | R2>
export function all<Input, E1, R1, E2, R2, E3, R3>(
  recipes: readonly [Recipe<Input, E1, R1>, Recipe<Input, E2, R2>, Recipe<Input, E3, R3>],
): Recipe<Input, RecipeCompositionError<E1 | E2 | E3>, R1 | R2 | R3>
export function all<Input, E, R>(
  recipes: ReadonlyArray<Recipe<Input, E, R>>,
): Recipe<Input, RecipeCompositionError<E>, R> {
  const name = `all(${recipes.map((recipe) => recipe.name).join(", ")})`
  const version = recipes.map((recipe) => recipe.version).join("+")
  const compiled = compileChildren(recipes, "every-child")

  return fromCompiled(
    name,
    version,
    compiled,
    (input: Input) =>
      Effect.forEach(recipes, (recipe) => recipe.run(input), { concurrency: "unbounded" }).pipe(
        Effect.flatMap((drafts) => Draft.concat(...drafts)),
      ),
    {
      schema: composedSchema(recipes),
      implementationHash: composedIdentity(name, version, recipes),
    },
  )
}

export type SnapshotPredicate = (
  snapshot: WorkspaceSnapshotService,
) => boolean | Effect.Effect<boolean>

/** Execute one of two recipes after a snapshot condition. */
export const branch = <Input = undefined, E1 = never, R1 = never, E2 = never, R2 = never>(
  predicate: SnapshotPredicate,
  ifTrue: Recipe<Input, E1, R1>,
  ifFalse: Recipe<Input, E2, R2>,
): Recipe<Input, E1 | E2, R1 | R2> => {
  const name = `branch(${ifTrue.name}, ${ifFalse.name})`
  const version = `${ifTrue.version}|${ifFalse.version}`
  const children = [ifTrue, ifFalse]
  const compiled = compileChildren(children, "one-child")

  return fromCompiled(
    name,
    version,
    compiled,
    (input: Input) =>
      Effect.gen(function* () {
        const snapshot = yield* WorkspaceSnapshot
        const result = predicate(snapshot)
        const condition = Effect.isEffect(result) ? yield* result : result
        return condition ? yield* ifTrue.run(input) : yield* ifFalse.run(input)
      }),
    {
      schema: composedSchema(children),
      implementationHash: composedIdentity(name, version, children),
    },
  )
}

/** Execute a recipe only when a snapshot condition is true. */
export const when = <Input = undefined, E = never, R = never>(
  predicate: SnapshotPredicate,
  recipe: Recipe<Input, E, R>,
): Recipe<Input, E, R> =>
  branch(
    predicate,
    recipe,
    fromCompiled(
      `${recipe.name}:noop`,
      recipe.version,
      { policy: Policy.all([]).policy, rules: [] },
      () => Effect.succeed(Draft.empty),
      {
        schema: recipe.schema,
        implementationHash: sha256(`${recipe.implementationHash}:noop`),
      },
    ),
  )

/** Policy composition for recipes that contain child recipes. */

interface MatchCountBounds {
  min?: number
  max?: number
}

type ChildExecution = "every-child" | "one-child"

const composeMatchCount = (
  recipes: ReadonlyArray<Recipe<any, any, any>>,
  execution: ChildExecution,
): MatchCountBounds => {
  if (recipes.length === 0) return {}
  const bounds = recipes.map((recipe) => recipe.policies.matchCount)
  const min =
    execution === "every-child"
      ? bounds.reduce((total, bound) => total + (bound.min ?? 0), 0)
      : Math.min(...bounds.map((bound) => bound.min ?? 0))
  const boundedMax = bounds.every((bound) => bound.max !== undefined)
  const matchCount: MatchCountBounds = { min }
  if (boundedMax) {
    matchCount.max =
      execution === "every-child"
        ? bounds.reduce((total, bound) => total + bound.max!, 0)
        : Math.max(...bounds.map((bound) => bound.max!))
  }
  return matchCount
}

const composeMaxAffectedFiles = (
  recipes: ReadonlyArray<Recipe<any, any, any>>,
  execution: ChildExecution,
): number | undefined => {
  if (
    recipes.length === 0 ||
    recipes.some((recipe) => recipe.policies.maxAffectedFiles === undefined)
  ) {
    return undefined
  }
  const maxima = recipes.map((recipe) => recipe.policies.maxAffectedFiles!)
  return execution === "every-child"
    ? maxima.reduce((total, maximum) => total + maximum, 0)
    : Math.max(...maxima)
}

/** Compose durable child policies according to which children execute. */
const compileChildren = (
  recipes: ReadonlyArray<Recipe<any, any, any>>,
  execution: ChildExecution,
) => ({
  policy: (() => {
    const matchCount = composeMatchCount(recipes, execution)
    const maxAffectedFiles = composeMaxAffectedFiles(recipes, execution)
    let idempotence: PlanPolicies["idempotence"] = "not-promised"
    for (const recipe of recipes) {
      if (recipe.policies.idempotence === "required") idempotence = "required"
    }
    const diagnostics: PlanPolicies["diagnostics"] =
      recipes.length === 0 ||
      recipes.some((recipe) => recipe.policies.diagnostics === "no-new-errors")
        ? "no-new-errors"
        : "allow-new-errors"
    return maxAffectedFiles === undefined
      ? { matchCount, diagnostics, idempotence }
      : { matchCount, maxAffectedFiles, diagnostics, idempotence }
  })(),
  rules: recipes.flatMap((recipe) => recipe.rules),
})
