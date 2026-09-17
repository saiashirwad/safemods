import { Effect, type FileSystem } from "effect"
import {
  canonicalJson,
  type PlanDecodeError,
  type TransformationPlan,
  validatePlan,
} from "../Plan.ts"
import { encodeInput, type Recipe, type RecipeInputError } from "../Recipe.ts"
import type { Overlay } from "../Workspace/Overlay.ts"
import {
  type ProjectNotInSnapshot,
  type ProjectSnapshotError,
  Workspace,
  type WorkspaceSnapshot,
} from "../Workspace/index.ts"
import { collectDiagnostics, type DiagnosticDiff, diffDiagnostics } from "./Diagnostics.ts"
import {
  type ProjectIdentityMismatch,
  RecipeMismatch,
  type StalePlanError,
  VerificationFailure,
} from "./Errors.ts"
import { type PlanPreview, previewValidated, requireWorkspaceProjects } from "./Preview.ts"
import { issue, type VerifiedPlan } from "./VerifiedPlan.ts"

const requireAuthoringRecipe = <Input, E, R>(
  plan: TransformationPlan,
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<void, RecipeMismatch | RecipeInputError> =>
  Effect.gen(function* () {
    const options = yield* encodeInput(recipe, input)
    const mismatches = {
      name: recipe.name !== plan.recipe.name,
      version: recipe.version !== plan.recipe.version,
      input: canonicalJson(options) !== canonicalJson(plan.recipe.options),
      policies: canonicalJson(recipe.policies) !== canonicalJson(plan.policies),
    }
    for (const field of ["name", "version", "input", "policies"] as const) {
      if (mismatches[field]) return yield* new RecipeMismatch({ planId: plan.planId, field })
    }
  })

const overlayOf = (workspace: Workspace["Service"], preview: PlanPreview): Overlay => {
  const files = new Map<string, string>()
  const deleted = new Set<string>()
  for (const file of preview.files) {
    if (file.after.exists) files.set(workspace.absolutePath(file), file.after.text)
    else deleted.add(workspace.absolutePath(file))
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
  | PlanDecodeError
  | ProjectIdentityMismatch
  | RecipeMismatch
  | RecipeInputError
  | StalePlanError
  | VerificationFailure
  | ProjectSnapshotError
  | ProjectNotInSnapshot,
  Workspace | FileSystem.FileSystem | Exclude<R, WorkspaceSnapshot>
> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const validated = yield* validatePlan(plan)
    yield* requireWorkspaceProjects(validated)
    yield* requireAuthoringRecipe(validated, recipe, input)
    const preview = yield* previewValidated(validated)

    const replay =
      validated.policies.idempotence === "required"
        ? Effect.map(recipe.run(input), (draft) => draft.edits.length + draft.fileOperations.length)
        : Effect.succeed(0)
    const [baseline, [proposed, replayedChanges]] = yield* Effect.all(
      [
        workspace.withSnapshot(collectDiagnostics),
        workspace.withSnapshot(
          Effect.all([collectDiagnostics, replay]),
          overlayOf(workspace, preview),
        ),
      ],
      { concurrency: 2 },
    )

    const diff = diffDiagnostics(baseline, proposed)
    const failure = policyFailure(validated, preview, diff, replayedChanges)
    if (failure !== undefined) {
      return yield* new VerificationFailure({ planId: validated.planId, ...failure })
    }
    return issue(workspace, validated, preview, diff)
  })
