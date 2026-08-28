/** Complete verification orchestration and VerifiedPlan issuance. */
import { Effect, type FileSystem, Path, Schema } from "effect"
import {
  Workspace,
  type ProjectNotInSnapshot,
  type SnapshotExpired,
  type WorkspaceCompilerError,
  type WorkspaceSnapshot,
} from "../Workspace/index.ts"
import type { Json } from "../Evidence/index.ts"
import {
  canonicalJson,
  type PlanDecodeError,
  validatePlan,
  type TransformationPlan,
} from "../Plan/index.ts"
import {
  allowedErrorsFromRules,
  computeDiagnosticDiff,
  type DiagnosticDiff,
  type DiagnosticRecord,
  type PolicyEvaluationContext,
} from "../Policy/index.ts"
import { resolvePlanFilePath, unsafePlanFilePathMessage } from "../ProjectPath/index.ts"
import { TOOLCHAIN, type Recipe } from "../Recipe/index.ts"
import { decodeRecipeInput, encodeRecipeInput } from "../Recipe/Input.ts"
import type { VirtualFsSnapshot } from "../VirtualFs/index.ts"
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
import { of, type PlanPreview } from "./Preview.ts"
import { evaluateBuiltInPolicies, evaluateCustomRules } from "./PolicyEvaluation.ts"
import type { VerificationReceipt } from "./VerificationReceipt.ts"
import { requireMatchingProjectIdentity } from "./SourceRevalidation.ts"
import { issueVerifiedPlan, type VerifiedPlan } from "./VerifiedPlan.ts"

const decodeJson = Schema.decodeUnknownSync(Schema.Json)

const canonicalInput = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
  planId: string,
  expected: Json,
): Effect.Effect<{ readonly value: Input; readonly json: Json }, RecipeInputMismatch> =>
  Effect.gen(function* () {
    let validated = input
    if (recipe.schema !== undefined) {
      validated = yield* decodeRecipeInput(recipe.schema, input)
      const encoded = yield* encodeRecipeInput(recipe.schema, validated)
      const json = encoded ?? null
      return { value: validated, json }
    }
    const json = decodeJson(validated ?? null)
    return { value: validated, json }
  }).pipe(Effect.mapError(() => new RecipeInputMismatch({ planId, expected, actual: null })))

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

    const encoded = yield* canonicalInput(recipe, input, plan.planId, plan.recipe.options)
    if (canonicalJson(encoded.json) !== canonicalJson(plan.recipe.options)) {
      return yield* new RecipeInputMismatch({
        planId: plan.planId,
        expected: plan.recipe.options,
        actual: encoded.json,
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
    return encoded.value
  })

const absoluteTarget = (
  workspaceRoot: string,
  plan: TransformationPlan,
  projectId: string,
  fileName: string,
): Effect.Effect<string, VerificationFailure, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const resolved = resolvePlanFilePath(path, plan, workspaceRoot, projectId, fileName)
    if (resolved === undefined) {
      return yield* new VerificationFailure({
        planId: plan.planId,
        policy: "edits",
        detail: unsafePlanFilePathMessage(projectId, fileName),
      })
    }
    return resolved.fileName
  })

const errorCount = (diagnostics: ReadonlyArray<DiagnosticRecord>): number =>
  diagnostics.filter((d) => d.category === "error").length

export interface VerifyOptions {
  readonly preview?: PlanPreview | undefined
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
  VerifiedPlan & { readonly diagnosticDiff: DiagnosticDiff },
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
    const proposed = options?.preview ?? (yield* of(validatedPlan))

    const files = new Map<string, string>()
    const created = new Set<string>()
    const deleted = new Set<string>()
    for (const file of proposed.files) {
      const target = yield* absoluteTarget(
        workspace.root,
        validatedPlan,
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
    const builtIn = evaluateBuiltInPolicies({
      policies: validatedPlan.policies,
      actualMatches: matches,
      affectedFiles,
      diagnosticDiff,
      secondPlanChangeCount: proposedRun.replayChanges,
      allowedErrors,
    })
    if (builtIn.failure !== undefined) {
      return yield* new VerificationFailure({ planId: validatedPlan.planId, ...builtIn.failure })
    }

    const context: PolicyEvaluationContext = {
      actualMatches: matches ?? 0,
      affectedFiles,
      diagnosticDiff,
      replayEdits: proposedRun.replayChanges,
      allowedErrors,
    }
    const custom = evaluateCustomRules(recipe.rules, context)
    if (custom.failure !== undefined) {
      return yield* new VerificationFailure({ planId: validatedPlan.planId, ...custom.failure })
    }

    const receipt: VerificationReceipt = {
      diagnosticDelta: errorCount(diagnosticDiff.introduced) - errorCount(diagnosticDiff.resolved),
      idempotenceChecked: validatedPlan.policies.idempotence === "required",
      policyResults: [...builtIn.results, ...custom.results],
    }
    return issueVerifiedPlan(validatedPlan, proposed, receipt, diagnosticDiff)
  })
