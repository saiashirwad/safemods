/** Scoped native TypeScript compiler lifecycle and snapshot manager. */
import { Context, Effect, Layer, type Scope } from "effect"
import { API, type APIOptions, type Snapshot, type TimingInfo } from "typescript/unstable/async"
import type { UpdateSnapshotParams } from "typescript/unstable/proto"
import { nativeRequest, type WorkspaceCompilerError } from "../NativeRequest.ts"

export interface NativeCompilerService {
  readonly openSnapshot: (
    params?: UpdateSnapshotParams,
  ) => Effect.Effect<Snapshot, WorkspaceCompilerError, Scope.Scope>
  readonly getTiming: Effect.Effect<TimingInfo, WorkspaceCompilerError>
  readonly resetTiming: Effect.Effect<void, WorkspaceCompilerError>
}

export class NativeCompiler extends Context.Service<NativeCompiler, NativeCompilerService>()(
  // oxlint-disable-next-line effecttsgo/deterministic-keys -- Stable internal service identifier.
  "@safemods/internal/NativeCompiler",
) {}

export const make = (
  options: APIOptions,
): Effect.Effect<NativeCompiler["Service"], never, Scope.Scope> =>
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

    const getTiming: Effect.Effect<TimingInfo, WorkspaceCompilerError> = nativeRequest(
      "getTimingInfo",
      () => api.getTimingInfo(),
    )

    const resetTiming: Effect.Effect<void, WorkspaceCompilerError> = nativeRequest(
      "resetTimingInfo",
      () => api.resetTimingInfo(),
    )

    return NativeCompiler.of({ openSnapshot, getTiming, resetTiming })
  })

export const layer = (options: APIOptions): Layer.Layer<NativeCompiler> =>
  Layer.effect(NativeCompiler, make(options))
