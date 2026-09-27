import { Effect, FileSystem, type PlatformError } from "effect"
import * as FileRef from "../FileRef.ts"
import { type Contents, type InvalidPlan, type Plan, targetOf, validate } from "../Plan.ts"
import { checkInput, type Recipe, type RecipeInputError } from "../Recipe.ts"
import * as Sha256 from "../Sha256.ts"
import type { Overlay } from "../Workspace/Overlay.ts"
import {
  type OverlappingProjectOwnership,
  type ProjectNotInSnapshot,
  type ProjectNotInWorkspace,
  type ProjectSnapshotError,
  Workspace,
  WorkspaceSnapshot,
} from "../Workspace/index.ts"
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
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound" ? Effect.succeed(undefined) : Effect.fail(cause)
      ),
    ))

const has = (contents: Contents, file: FileRef.FileRef): boolean =>
  contents.get(file.projectId)?.has(file.fileName) === true

const withTargets = (captured: Contents, plan: Plan) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const contents: FileRef.Map<Uint8Array | undefined> = new Map()
    for (const [file, bytes] of FileRef.entries(captured)) FileRef.set(contents, file, bytes)
    for (const operation of plan.fileOperations) {
      const target = targetOf(operation)
      if (operation.kind !== "delete" && !has(contents, target)) {
        FileRef.set(contents, target, yield* readOptional(yield* workspace.absolutePath(target)))
      }
    }
    return contents
  })

const overlayOf = Effect.fn(function* (
  workspace: Workspace["Service"],
  files: ReadonlyArray<FilePreview>,
  side: "before" | "after",
) {
  const overlay = { files: new Map<string, string>(), deleted: new Set<string>() }
  for (const file of files) {
    const state = file[side]
    if (state.exists) overlay.files.set(yield* workspace.absolutePath(file), state.text)
    else overlay.deleted.add(yield* workspace.absolutePath(file))
  }
  return overlay satisfies Overlay
})

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
    const contents: FileRef.Map<Uint8Array | undefined> = new Map()
    for (const file of [...preview.sources, ...preview.files]) {
      FileRef.set(contents, file, file.after.exists ? file.after.bytes : undefined)
    }
    const plan = yield* recipe.run(input)
    const snapshot = yield* WorkspaceSnapshot
    for (const file of [...plan.edits, ...plan.fileOperations]) {
      if (has(contents, file)) continue
      const found = yield* (yield* snapshot.project(file.projectId)).file(file.fileName)
      if (found !== undefined) {
        FileRef.set(contents, file, new TextEncoder().encode(found.sourceFile.text))
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
  | ProjectSnapshotError
  | ProjectNotInSnapshot
  | ProjectNotInWorkspace
  | OverlappingProjectOwnership,
  Workspace | FileSystem.FileSystem | Exclude<R, WorkspaceSnapshot>
> =>
  Effect.gen(function* () {
    yield* checkInput(recipe, input)
    const workspace = yield* Workspace
    const [plan, contents] = yield* workspace.withSnapshot(
      Effect.gen(function* () {
        const captured = yield* (yield* WorkspaceSnapshot).capture
        const plan = yield* recipe.run(input)
        return [plan, yield* withTargets(captured, plan)] as const
      }),
    )
    yield* validate(plan, contents)
    const preview = yield* previewOf(plan, contents)

    const baseline = yield* workspace.withSnapshot(
      collectDiagnostics,
      yield* overlayOf(workspace, preview.sources, "before"),
    )
    const [proposed, replayed] = yield* workspace.withSnapshot(
      Effect.all([
        collectDiagnostics,
        recipe.policies.idempotence === "required" ?
          replayedChanges(recipe, input, preview) :
          Effect.succeed(0),
      ]),
      yield* overlayOf(workspace, [...preview.sources, ...preview.files], "after"),
    )

    const moves = new Map<string, string>()
    for (const operation of plan.fileOperations) {
      if (operation.kind === "move") {
        moves.set(
          yield* workspace.absolutePath(operation),
          yield* workspace.absolutePath(targetOf(operation)),
        )
      }
    }
    const diagnosticDiff = diffDiagnostics(baseline, proposed, moves)
    const failure = policyFailure(recipe, preview, diagnosticDiff, replayed)
    if (failure !== undefined) return yield* failure
    return { plan, preview, diagnosticDiff } as VerifiedPlan
  })
