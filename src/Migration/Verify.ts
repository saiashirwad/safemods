import type { Proposal } from "../Proposal.ts"
import type { Finding } from "../Finding.ts"
import { apply, type ApplicationReceipt, type ApplicationFailure } from "./Apply.ts"
import { Crypto, Effect, FileSystem, Path, type PlatformError } from "effect"
import { type Contents, distinct, type InvalidProposal, targetOf, validate } from "./Changes.ts"
import { checkInput, type Recipe, type RecipeInputError } from "../Recipe.ts"
import type { Overlay } from "../Workspace/Overlay.ts"
import { type ProjectSnapshotError, Workspace, type WorkspaceSnapshot } from "../Workspace/index.ts"
import { InputSnapshot } from "../Workspace/InputSnapshot.ts"
import { WorkspaceCompilerError } from "../Workspace/NativeRequest.ts"
import type * as WorkspacePath from "../WorkspacePath.ts"
import { collectDiagnostics, type DiagnosticDiff, diffDiagnostics } from "./Diagnostics.ts"
import { VerificationFailure, StaleMigrationError } from "./Errors.ts"
import { type FilePreview, type MigrationPreview, previewOf } from "./Preview.ts"

export interface VerifiedMigration {
  readonly preview: MigrationPreview
  readonly unsupported: ReadonlyArray<Finding>
  readonly diagnosticDiff: DiagnosticDiff
  readonly apply: Effect.Effect<ApplicationReceipt, ApplicationFailure | StaleMigrationError>
}

const withTargets = (captured: Contents, plan: Proposal, inputs: InputSnapshot) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const contents = new Map(captured)
    for (const operation of plan.fileOperations) {
      const target = targetOf(operation)
      if (operation.kind !== "delete" && !contents.has(target)) {
        const bytes = yield* Effect.try({
          try: () => inputs.readBytes(workspace.absolutePath(target)),
          catch: (cause) => new WorkspaceCompilerError({ operation: "readTarget", cause }),
        })
        contents.set(target, bytes)
      }
    }
    return contents
  })

const overlayOf = (
  workspace: Workspace["Service"],
  files: ReadonlyArray<FilePreview>,
): Overlay => {
  const overlay = { files: new Map<string, string>(), deleted: new Set<string>() }
  for (const file of files) {
    const state = file.after
    const absolute = workspace.absolutePath(file.fileName)
    if (state.exists) overlay.files.set(absolute, state.text)
    else overlay.deleted.add(absolute)
  }
  return overlay
}

const replayedChanges = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  input: Input,
  preview: MigrationPreview,
  snapshot: WorkspaceSnapshot,
) =>
  Effect.gen(function* () {
    const contents = new Map<WorkspacePath.Type, Uint8Array | undefined>(yield* snapshot.capture)
    for (const file of [...preview.sources, ...preview.files]) {
      contents.set(file.fileName, file.after.exists ? file.after.bytes : undefined)
    }
    const plan = distinct(yield* recipe.run(snapshot, input))
    const invalid = ({ detail }: InvalidProposal) =>
      new VerificationFailure({
        policy: "idempotence",
        detail: `Invalid replay proposal: ${detail}`,
      })
    yield* validate(plan, contents).pipe(Effect.mapError(invalid))
    const replayed = yield* previewOf(plan, contents).pipe(Effect.mapError(invalid))
    return replayed.files.length
  })

const policyFailure = <Input, E, R>(
  recipe: Recipe<Input, E, R>,
  preview: MigrationPreview,
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
  VerifiedMigration,
  | E
  | InvalidProposal
  | RecipeInputError
  | PlatformError.PlatformError
  | VerificationFailure
  | StaleMigrationError
  | ProjectSnapshotError,
  Workspace | FileSystem.FileSystem | Path.Path | Crypto.Crypto | R
> =>
  Effect.gen(function* () {
    yield* checkInput(recipe, input)
    const workspace = yield* Workspace
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const inputs = new InputSnapshot()
    const fresh = inputs.checkFresh.pipe(
      Effect.mapError(({ path }) =>
        new StaleMigrationError({
          path: workspace.relativePath(path) ?? path,
        })
      ),
    )
    const [plan, contents, baseline] = yield* workspace.withSnapshot(
      (snapshot) =>
        Effect.gen(function* () {
          const captured = yield* snapshot.capture
          const plan = distinct(yield* recipe.run(snapshot, input))
          return [
            plan,
            yield* withTargets(captured, plan, inputs),
            yield* collectDiagnostics(snapshot),
          ] as const
        }),
      { inputs },
    )
    yield* validate(plan, contents)
    const preview = yield* previewOf(plan, contents)

    const [proposed, replayed] = yield* workspace.withSnapshot(
      (snapshot) =>
        Effect.all([
          collectDiagnostics(snapshot),
          recipe.policies.idempotence === "required" ?
            replayedChanges(recipe, input, preview, snapshot) :
            Effect.succeed(0),
        ]),
      { inputs, overlay: overlayOf(workspace, [...preview.sources, ...preview.files]) },
    )

    const moves = new Map(
      plan.fileOperations.flatMap((operation) =>
        operation.kind === "move" ? [[operation.fileName, operation.toFileName] as const] : []
      ),
    )
    const diagnosticDiff = diffDiagnostics(baseline, proposed, moves)
    const failure = policyFailure(recipe, preview, diagnosticDiff, replayed)
    if (failure !== undefined) return yield* failure
    yield* fresh
    const capturedApply = Effect.andThen(fresh, apply(preview)).pipe(
      Effect.map((receipt) => structuredClone(receipt)),
      Effect.provideService(Workspace, workspace),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(Crypto.Crypto, crypto),
    )
    return {
      preview: structuredClone(preview),
      unsupported: structuredClone(plan.unsupported),
      diagnosticDiff: structuredClone(diagnosticDiff),
      apply: capturedApply,
    }
  })
