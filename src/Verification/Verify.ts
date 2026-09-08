/** Complete verification orchestration and VerifiedPlan issuance. */
import { Effect, type FileSystem, type Path, Schema } from "effect"
import {
  type ProjectNotInSnapshot,
  type SnapshotExpired,
  Workspace,
  type WorkspaceCompilerError,
  type WorkspaceSnapshot,
} from "../Workspace/index.ts"
import { canonicalJson } from "../Evidence.ts"
import type { PlanDecodeError, TransformationPlan } from "../Plan/TransformationPlan.ts"
import { validatePlan } from "../Plan/Codec.ts"
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
import { previewValidatedPlan } from "./Preview.ts"
import { computeDiagnosticDiff, evaluateBuiltInPolicies } from "./PolicyEvaluation.ts"
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

/**
 * Verify a plan with fresh baseline and proposed compiler snapshots. This
 * operation evaluates policies and returns application authority on success.
 */
export const verify = <Input, E, R>(
  plan: TransformationPlan,
  recipe: Recipe<Input, E, R>,
  input: Input,
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
        return {
          diagnostics,
          replayChanges: replay.edits.length + (replay.fileOperations?.length ?? 0),
        }
      }),
    )

    const diagnosticDiff = computeDiagnosticDiff(baselineDiagnostics, proposedRun.diagnostics)
    const matches = validatedPlan.measurements?.matches
    const affectedFiles = proposed.files.length
    const builtInFailure = evaluateBuiltInPolicies({
      policies: validatedPlan.policies,
      actualMatches: matches,
      affectedFiles,
      diagnosticDiff,
      secondPlanChangeCount: proposedRun.replayChanges,
    })
    if (builtInFailure !== undefined) {
      return yield* new VerificationFailure({ planId: validatedPlan.planId, ...builtInFailure })
    }

    return issueVerifiedPlan(validatedPlan, proposed, diagnosticDiff)
  })
