/** Recipe construction. */
import type { Schema } from "effect"
import { sha256 } from "../Edit/index.ts"
import type { PlanPolicies } from "../Plan/index.ts"
import * as Policy from "../Policy/index.ts"
import type { VerificationRule } from "../Policy/index.ts"
import type { Recipe, RecipeDefinition } from "./Recipe.ts"

/** Construct a recipe from durable policies and runtime rules. */
export const fromCompiled = <Input, E, R>(
  name: string,
  version: string,
  compiled: { readonly policy: PlanPolicies; readonly rules: ReadonlyArray<VerificationRule> },
  run: Recipe<Input, E, R>["run"],
  options: {
    readonly schema?: Schema.Schema<Input> | undefined
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
  const compiled = Policy.all(definition.policies ?? [])
  return fromCompiled(name, definition.version, compiled, definition.run, {
    schema: definition.schema,
    implementationHash: definition.implementationHash,
  })
}
