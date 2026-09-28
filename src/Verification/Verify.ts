import { Effect, FileSystem, type PlatformError } from "effect"
import {
  type Contents,
  distinct,
  type InvalidPlan,
  type Plan,
  targetOf,
  validate,
} from "../Plan.ts"
import { checkInput, type Recipe, type RecipeInputError } from "../Recipe.ts"
import * as Sha256 from "../Sha256.ts"
import type { Overlay } from "../Workspace/Overlay.ts"
import { type ProjectSnapshotError, Workspace, WorkspaceSnapshot } from "../Workspace/index.ts"
import type * as WorkspacePath from "../WorkspacePath.ts"
import { collectDiagnostics, type DiagnosticDiff, diffDiagnostics } from "./Diagnostics.ts"
import { VerificationFailure } from "./Errors.ts"
import { type FilePreview, type PlanPreview, previewOf } from "./Preview.ts"

declare const VerifiedPlanTypeId: unique symbol

export interface VerifiedPlan {
  readonly [VerifiedPlanTypeId]: true
  readonly plan: Plan
  readonly preview: PlanPreview
  readonly diagnosticDiff: DiagnosticDiff
}

const readOptional = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFile(path).pipe(
      Effect.catch((cause) => cause.reason._tag === "NotFound" ? Effect.succeed(undefined) : cause),
    ))

const withTargets = (captured: Contents, plan: Plan) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const contents = new Map(captured)
    for (const operation of plan.fileOperations) {
      const target = targetOf(operation)
      if (operation.kind !== "delete" && !contents.has(target)) {
        contents.set(target, yield* readOptional(workspace.absolutePath(target)))
      }
    }
    return contents
  })

const overlayOf = (
  workspace: Workspace["Service"],
  files: ReadonlyArray<FilePreview>,
  side: "before" | "after",
): Overlay => {
  const overlay = { files: new Map<string, string>(), deleted: new Set<string>() }
  for (const file of files) {
    const state = file[side]
    const absolute = workspace.absolutePath(file.fileName)
    if (state.exists) overlay.files.set(absolute, state.text)
    else overlay.deleted.add(absolute)
  }
  return overlay
}

const isChanged = ({ before, after }: FilePreview): boolean =>
  before.exists && after.exists ?
    Sha256.digest(before.bytes) !== Sha256.digest(after.bytes) :
    before.exists !== after.exists

const replayedChanges = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
  preview: PlanPreview,
) =>
  Effect.gen(function* () {
    const contents = new Map<WorkspacePath.Type, Uint8Array | undefined>()
    for (const file of [...preview.sources, ...preview.files]) {
      contents.set(file.fileName, file.after.exists ? file.after.bytes : undefined)
    }
    const plan = distinct(yield* recipe.run(input))
    const snapshot = yield* WorkspaceSnapshot
    for (const { fileName } of [...plan.edits, ...plan.fileOperations]) {
      if (contents.has(fileName)) continue
      const found = yield* snapshot.file(fileName)
      if (found !== undefined) {
        contents.set(fileName, new TextEncoder().encode(found.sourceFile.text))
      }
    }
    const invalid = ({ detail }: InvalidPlan) =>
      new VerificationFailure({ policy: "idempotence", detail: `Invalid replay plan: ${detail}` })
    yield* validate(plan, contents).pipe(Effect.mapError(invalid))
    const replayed = yield* previewOf(plan, contents).pipe(Effect.mapError(invalid))
    return replayed.files.filter(isChanged).length
  })

const policyFailure = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  preview: PlanPreview,
  diff: DiagnosticDiff,
  replayed: number,
): VerificationFailure | undefined => {
  const { maxAffectedFiles, diagnostics, idempotence } = recipe.policies
  if (preview.files.length > (maxAffectedFiles ?? Infinity)) {
    return new VerificationFailure({
      policy: "affected-files",
      detail: `Observed ${preview.files.length}`,
    })
  }
  const errors = diff.introduced.filter((diagnostic) => diagnostic.category === "error")
  if (diagnostics === "no-new-errors" && errors.length > 0) {
    return new VerificationFailure({
      policy: "diagnostics",
      detail: `Introduced ${errors.length} new error diagnostic(s)`,
      diagnostics: errors,
    })
  }
  if (idempotence === "required" && replayed > 0) {
    return new VerificationFailure({
      policy: "idempotence",
      detail: `Second run proposed ${replayed} change(s)`,
    })
  }
  return undefined
}

export const verify = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
): Effect.Effect<
  VerifiedPlan,
  | E
  | InvalidPlan
  | RecipeInputError
  | PlatformError.PlatformError
  | VerificationFailure
  | ProjectSnapshotError,
  Workspace | FileSystem.FileSystem | Exclude<R, WorkspaceSnapshot>
> =>
  Effect.gen(function* () {
    yield* checkInput(recipe, input)
    const workspace = yield* Workspace
    const [plan, contents] = yield* workspace.withSnapshot(
      Effect.gen(function* () {
        const captured = yield* (yield* WorkspaceSnapshot).capture
        const plan = distinct(yield* recipe.run(input))
        return [plan, yield* withTargets(captured, plan)] as const
      }),
    )
    yield* validate(plan, contents)
    const preview = yield* previewOf(plan, contents)

    const baseline = yield* workspace.withSnapshot(
      collectDiagnostics,
      overlayOf(workspace, preview.sources, "before"),
    )
    const [proposed, replayed] = yield* workspace.withSnapshot(
      Effect.all([
        collectDiagnostics,
        recipe.policies.idempotence === "required" ?
          replayedChanges(recipe, input, preview) :
          Effect.succeed(0),
      ]),
      overlayOf(workspace, [...preview.sources, ...preview.files], "after"),
    )

    const moves = new Map(
      plan.fileOperations.flatMap((operation) =>
        operation.kind === "move" ? [[operation.fileName, operation.toFileName] as const] : []
      ),
    )
    const diagnosticDiff = diffDiagnostics(baseline, proposed, moves)
    const failure = policyFailure(recipe, preview, diagnosticDiff, replayed)
    if (failure !== undefined) return yield* failure
    return { plan, preview, diagnosticDiff } as VerifiedPlan
  })
