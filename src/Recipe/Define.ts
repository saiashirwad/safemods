/** Recipe construction. */
import { sha256 } from "../Edit/index.ts"
import * as Policy from "../Policy/index.ts"
import type { CompiledPolicy } from "../Policy/index.ts"
import type { Recipe, RecipeDefinition } from "./Recipe.ts"

/** Construct a recipe from durable policies and runtime rules. */
export const fromCompiled = <Input, E, R>(
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
  const compiled = Policy.all(definition.policies ?? [])
  return fromCompiled(name, definition.version, compiled, definition.run, {
    schema: definition.schema,
    implementationHash: definition.implementationHash,
  })
}
