import { Effect, type FileSystem, Schema } from "effect"
import * as FileRef from "../FileRef.ts"
import {
  finalizePlan,
  PlanPolicies,
  type InvalidPlan,
  type TransformationPlan,
  validatePlan,
} from "../Plan.ts"
import { encodeInput, type Recipe, type RecipeInputError } from "../Recipe.ts"
import * as Sha256 from "../Sha256.ts"
import type { Overlay } from "../Workspace/Overlay.ts"
import {
  type OverlappingProjectOwnership,
  type ProjectNotInSnapshot,
  type ProjectSnapshotError,
  Workspace,
  type WorkspaceSnapshot,
} from "../Workspace/index.ts"
import { collectDiagnostics, type DiagnosticDiff, diffDiagnostics } from "./Diagnostics.ts"
import { PlanContextMismatch, type StalePlanError, VerificationFailure } from "./Errors.ts"
import {
  type PlanPreview,
  previewCaptured,
  previewValidated,
  requireWorkspaceProjects,
} from "./Preview.ts"
import { issue, type VerifiedPlan } from "./VerifiedPlan.ts"

const policiesEquivalent = Schema.toEquivalence(PlanPolicies)

const requireAuthoringRecipe = <Input, E, R>(
  plan: TransformationPlan,
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<void, PlanContextMismatch | RecipeInputError> =>
  Effect.gen(function* () {
    const options = yield* encodeInput(recipe, input)
    const inputMatches =
      recipe.schema === undefined
        ? Schema.toEquivalence(Schema.Json)(options, plan.recipe.options)
        : Schema.toEquivalence(recipe.schema)(
            input,
            yield* Schema.decodeUnknownEffect(recipe.schema)(plan.recipe.options).pipe(
              Effect.mapError(
                () => new PlanContextMismatch({ planId: plan.planId, field: "input" }),
              ),
            ),
          )
    const mismatches = {
      name: recipe.name !== plan.recipe.name,
      version: recipe.version !== plan.recipe.version,
      input: !inputMatches,
      policies: !policiesEquivalent(recipe.policies, plan.policies),
    }
    for (const field of ["name", "version", "input", "policies"] as const) {
      if (mismatches[field]) return yield* new PlanContextMismatch({ planId: plan.planId, field })
    }
  })

const overlayOf = (
  workspace: Workspace["Service"],
  preview: PlanPreview,
  after: boolean,
): Overlay => {
  const files = new Map<string, string>()
  const deleted = new Set<string>()
  for (const file of preview.sources) {
    const state = after ? file.after : file.before
    if (state.exists) files.set(workspace.absolutePath(file), state.text)
    else deleted.add(workspace.absolutePath(file))
  }
  if (after) {
    for (const file of preview.files) {
      if (file.after.exists) files.set(workspace.absolutePath(file), file.after.text)
      else deleted.add(workspace.absolutePath(file))
    }
  }
  return { files, deleted }
}

const policyFailure = (
  plan: TransformationPlan,
  preview: PlanPreview,
  diff: DiagnosticDiff,
  replayedChanges: number,
): Pick<VerificationFailure, "policy" | "detail" | "diagnostics"> | undefined => {
  const { maxAffectedFiles, diagnostics, idempotence } = plan.policies
  if (preview.files.length > (maxAffectedFiles ?? Infinity)) {
    return { policy: "affected-files", detail: `Observed ${preview.files.length}` }
  }
  const errors = diff.introduced.filter((diagnostic) => diagnostic.category === "error")
  if (diagnostics === "no-new-errors" && errors.length > 0) {
    const summary = errors.map((error) => `TS${error.code}: ${error.message}`).join("; ")
    return {
      policy: "diagnostics",
      detail: `Introduced ${errors.length} new error diagnostic(s): ${summary}`,
      diagnostics: errors,
    }
  }
  if (idempotence === "required" && replayedChanges > 0) {
    return { policy: "idempotence", detail: `Second run proposed ${replayedChanges} change(s)` }
  }
  return undefined
}

export const verify = <Input, E, R>(
  plan: TransformationPlan,
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<
  VerifiedPlan,
  | E
  | InvalidPlan
  | PlanContextMismatch
  | RecipeInputError
  | StalePlanError
  | VerificationFailure
  | ProjectSnapshotError
  | ProjectNotInSnapshot
  | OverlappingProjectOwnership,
  Workspace | FileSystem.FileSystem | Exclude<R, WorkspaceSnapshot>
> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const validated = yield* validatePlan(plan)
    yield* requireWorkspaceProjects(validated)
    yield* requireAuthoringRecipe(validated, recipe, input)
    const preview = yield* previewValidated(validated)
    const baselineOverlay = overlayOf(workspace, preview, false)
    const proposedOverlay = overlayOf(workspace, preview, true)

    const baseline = yield* workspace.withSnapshot(collectDiagnostics, baselineOverlay)
    const [proposed, replayedChanges] = yield* workspace.withSnapshot(
      Effect.gen(function* () {
        const diagnostics = yield* collectDiagnostics
        if (validated.policies.idempotence !== "required") return [diagnostics, 0] as const
        const draft = yield* recipe.run(input)
        const captured: FileRef.Map<Uint8Array | undefined> = new Map()
        for (const file of preview.sources) {
          FileRef.set(captured, file, file.after.exists ? file.after.bytes : undefined)
        }
        for (const file of preview.files) {
          FileRef.set(captured, file, file.after.exists ? file.after.bytes : undefined)
        }
        const replayPlan = yield* finalizePlan({
          recipe: validated.recipe,
          projects: validated.projects,
          sources: [...FileRef.entries(captured)].map(([file, bytes]) =>
            bytes === undefined
              ? { ...file, kind: "missing" as const }
              : { ...file, kind: "file" as const, hash: Sha256.digest(bytes) },
          ),
          edits: draft.edits,
          fileOperations: draft.fileOperations,
          policies: validated.policies,
        }).pipe(
          Effect.mapError(
            ({ detail }) =>
              new VerificationFailure({
                planId: validated.planId,
                policy: "idempotence",
                detail: `Invalid replay plan: ${detail}`,
              }),
          ),
        )
        const replayPreview = yield* previewCaptured(
          yield* validatePlan(replayPlan),
          captured,
        ).pipe(
          Effect.mapError(
            ({ detail }) =>
              new VerificationFailure({
                planId: validated.planId,
                policy: "idempotence",
                detail: `Invalid replay plan: ${detail}`,
              }),
          ),
        )
        const changed = replayPreview.files.filter((file) => {
          if (file.before.exists !== file.after.exists) return true
          return file.before.exists && file.after.exists
            ? Sha256.digest(file.before.bytes) !== Sha256.digest(file.after.bytes)
            : false
        }).length
        return [diagnostics, changed] as const
      }),
      proposedOverlay,
    )

    const moves = new Map(
      validated.fileOperations.flatMap((operation) =>
        operation.kind === "move"
          ? [
              [
                workspace.absolutePath(operation),
                workspace.absolutePath({
                  projectId: operation.projectId,
                  fileName: operation.toFileName,
                }),
              ] as const,
            ]
          : [],
      ),
    )
    const diff = diffDiagnostics(baseline, proposed, moves)
    const failure = policyFailure(validated, preview, diff, replayedChanges)
    if (failure !== undefined) {
      return yield* new VerificationFailure({ planId: validated.planId, ...failure })
    }
    return issue(workspace, validated, preview, diff)
  })
