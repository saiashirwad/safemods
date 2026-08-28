/** Recipe values and author definitions. */
import type { Effect, Schema } from "effect"
import type { Draft } from "../Draft/index.ts"
import type { PlanPolicies } from "../Plan/index.ts"
import type { Policy, VerificationRule } from "../Policy/index.ts"
import type { Workspace, WorkspaceSnapshot } from "../Workspace/index.ts"

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
  readonly schema?: Schema.Schema<Input> | undefined
  readonly run: (input: Input) => Effect.Effect<Draft, E, R | WorkspaceSnapshot | Workspace>
}

export interface RecipeDefinition<Input, E, R> {
  readonly version: string
  readonly schema?: Schema.Schema<Input>
  /** Digest supplied by release tooling. The development default uses name and version. */
  readonly implementationHash?: string
  readonly policies?: ReadonlyArray<Policy>
  readonly run: (input: Input) => Effect.Effect<Draft, E, R | WorkspaceSnapshot | Workspace>
}
