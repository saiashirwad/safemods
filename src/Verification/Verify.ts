/** Complete verification orchestration and VerifiedPlan issuance. */
import { Effect, type FileSystem, type Path, Schema } from "effect"
import {
  type ProjectNotInSnapshot,
  type SnapshotExpired,
  Workspace,
  type WorkspaceCompilerError,
  type WorkspaceSnapshot,
} from "../Workspace/index.ts"
import {
  canonicalJson,
  type PlanDecodeError,
  type TransformationPlan,
  validatePlan,
} from "../Plan/index.ts"
import {
  allowedErrorsFromRules,
  computeDiagnosticDiff,
  type PolicyEvaluationContext,
} from "../Policy.ts"
import { type Recipe, TOOLCHAIN, validateRecipeInput } from "../Recipe.ts"
import type { VirtualFsSnapshot } from "../VirtualFs.ts"
import { collectDiagnostics } from "./Diagnostics.ts"
import {
  PolicyMismatch,
  type ProjectIdentityMismatch,
  RecipeInputMismatch,
  RecipeMismatch,
  type StalePlanError,
  ToolchainMismatch,
  VerificationFailure,
} from "./Errors.ts"
import { type PlanPreview, previewValidatedPlan } from "./Preview.ts"
import { evaluateBuiltInPolicies, evaluateCustomRules } from "./PolicyEvaluation.ts"
import { absoluteTarget, requireMatchingProjectIdentity } from "./SourceRevalidation.ts"
import { issueVerifiedPlan, type VerifiedPlan } from "./VerifiedPlan.ts"

const decodeJson = Schema.decodeUnknownSync(Schema.Json)

const validateRecipeForPlan = <Input, E, R>(
  plan: TransformationPlan,
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<
  Input,
  RecipeMismatch | RecipeInputMismatch | PolicyMismatch | ToolchainMismatch
> =>
  Effect.gen(function* () {
    const expectedIdentity = {
      name: plan.recipe.name,
      version: plan.recipe.version,
      implementationHash: plan.recipe.implementationHash,
    }
    const actualIdentity = {
      name: recipe.name,
      version: recipe.version,
      implementationHash: recipe.implementationHash,
    }
    if (
      expectedIdentity.name !== actualIdentity.name ||
      expectedIdentity.version !== actualIdentity.version ||
      expectedIdentity.implementationHash !== actualIdentity.implementationHash
    ) {
      return yield* new RecipeMismatch({
        planId: plan.planId,
        expected: expectedIdentity,
        actual: actualIdentity,
      })
    }

    const validated = yield* validateRecipeInput(recipe, input).pipe(
      Effect.mapError(
        () =>
          new RecipeInputMismatch({
            planId: plan.planId,
            expected: plan.recipe.options,
            actual: null,
          }),
      ),
    )
    if (canonicalJson(validated.encoded) !== canonicalJson(plan.recipe.options)) {
      return yield* new RecipeInputMismatch({
        planId: plan.planId,
        expected: plan.recipe.options,
        actual: validated.encoded,
      })
    }

    if (canonicalJson(decodeJson(recipe.policies)) !== canonicalJson(decodeJson(plan.policies))) {
      return yield* new PolicyMismatch({
        planId: plan.planId,
        expected: plan.policies,
        actual: recipe.policies,
      })
    }

    if (canonicalJson(decodeJson(TOOLCHAIN)) !== canonicalJson(decodeJson(plan.toolchain))) {
      return yield* new ToolchainMismatch({
        planId: plan.planId,
        expected: plan.toolchain,
        actual: TOOLCHAIN,
      })
    }
    return validated.value
  })

export interface VerifyOptions {
  readonly onPreview?: ((preview: PlanPreview) => Effect.Effect<void>) | undefined
}

/**
 * Verify a plan with fresh baseline and proposed compiler snapshots. This
 * operation evaluates policies and returns application authority on success.
 */
export const verify = <Input, E, R>(
  plan: TransformationPlan,
  recipe: Recipe<Input, E, R>,
  input: Input,
  options?: VerifyOptions | undefined,
): Effect.Effect<
  VerifiedPlan,
  | E
  | VerificationFailure
  | StalePlanError
  | RecipeMismatch
  | RecipeInputMismatch
  | PolicyMismatch
  | ToolchainMismatch
  | PlanDecodeError
  | ProjectIdentityMismatch
  | WorkspaceCompilerError
  | ProjectNotInSnapshot
  | SnapshotExpired,
  Workspace | FileSystem.FileSystem | Path.Path | Exclude<R, WorkspaceSnapshot>
> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const validatedPlan = yield* validatePlan(plan)
    yield* requireMatchingProjectIdentity(validatedPlan, workspace.definition.projects)
    const validatedInput = yield* validateRecipeForPlan(validatedPlan, recipe, input)
    const proposed = yield* previewValidatedPlan(validatedPlan, workspace.root)
    if (options?.onPreview !== undefined) yield* options.onPreview(proposed)

    const files = new Map<string, string>()
    const created = new Set<string>()
    const deleted = new Set<string>()
    for (const file of proposed.files) {
      const target = yield* absoluteTarget(
        validatedPlan,
        workspace.root,
        file.projectId,
        file.fileName,
      )
      if (file.after.exists) {
        files.set(target, file.after.text)
        if (!file.before.exists) created.add(target)
      } else {
        deleted.add(target)
      }
    }
    const overlay: VirtualFsSnapshot = { files, created, deleted }

    const baselineDiagnostics = yield* workspace.withIsolatedSnapshot(
      { files: new Map(), created: new Set(), deleted: new Set() },
      collectDiagnostics,
    )

    const proposedRun = yield* workspace.withIsolatedSnapshot(
      overlay,
      Effect.gen(function* () {
        const diagnostics = yield* collectDiagnostics
        if (validatedPlan.policies.idempotence !== "required") {
          // SAFETY: no replay is requested, so this optional count is absent by construction.
          return { diagnostics, replayChanges: undefined }
        }
        const replay = yield* recipe.run(validatedInput)
        // SAFETY: both collections are normalized recipe output. File
        // operations are changes just like text edits for idempotence.
        return {
          diagnostics,
          replayChanges: replay.edits.length + (replay.fileOperations?.length ?? 0),
        }
      }),
    )

    const diagnosticDiff = computeDiagnosticDiff(baselineDiagnostics, proposedRun.diagnostics)
    const allowedErrors = allowedErrorsFromRules(recipe.rules)
    const matches = validatedPlan.measurements?.matches
    const affectedFiles = proposed.files.length
    const builtInFailure = evaluateBuiltInPolicies({
      policies: validatedPlan.policies,
      actualMatches: matches,
      affectedFiles,
      diagnosticDiff,
      secondPlanChangeCount: proposedRun.replayChanges,
      allowedErrors,
    })
    if (builtInFailure !== undefined) {
      return yield* new VerificationFailure({ planId: validatedPlan.planId, ...builtInFailure })
    }

    const context: PolicyEvaluationContext = {
      actualMatches: matches ?? 0,
      affectedFiles,
      diagnosticDiff,
      allowedErrors,
    }
    const customFailure = evaluateCustomRules(recipe.rules, context)
    if (customFailure !== undefined) {
      return yield* new VerificationFailure({ planId: validatedPlan.planId, ...customFailure })
    }

    return issueVerifiedPlan(validatedPlan, proposed, diagnosticDiff)
  })
