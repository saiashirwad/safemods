/** Policy composition for recipes that contain child recipes. */
import type { PlanPolicies } from "../Plan/index.ts"
import type { Recipe } from "./Recipe.ts"

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
export const compileChildren = (
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
        : "exact-delta"
    return maxAffectedFiles === undefined
      ? { matchCount, diagnostics, idempotence }
      : { matchCount, maxAffectedFiles, diagnostics, idempotence }
  })(),
  rules: recipes.flatMap((recipe) => recipe.rules),
})
