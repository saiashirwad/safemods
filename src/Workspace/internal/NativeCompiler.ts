/** Scoped native TypeScript compiler lifecycle and snapshot manager. */
import { Effect, type Scope } from "effect"
import { API, type APIOptions, type Snapshot } from "typescript/unstable/async"
import type { UpdateSnapshotParams } from "typescript/unstable/proto"
import { nativeRequest, type WorkspaceCompilerError } from "../NativeRequest.ts"

export interface NativeCompiler {
  readonly openSnapshot: (
    params?: UpdateSnapshotParams,
  ) => Effect.Effect<Snapshot, WorkspaceCompilerError, Scope.Scope>
}

export const openCompiler = (
  options: APIOptions,
): Effect.Effect<NativeCompiler, never, Scope.Scope> =>
  Effect.gen(function* () {
    const api = yield* Effect.acquireRelease(
      Effect.sync(() => new API(options)),
      (api) => Effect.promise(() => api.close()),
    )

    const openSnapshot = Effect.fn("NativeCompiler.openSnapshot")((params?: UpdateSnapshotParams) =>
      Effect.acquireRelease(
        nativeRequest("updateSnapshot", () => api.updateSnapshot(params)),
        (snapshot) => Effect.promise(() => snapshot.dispose()),
      ),
    )

    return { openSnapshot }
  })
