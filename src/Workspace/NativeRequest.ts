import { Data, Effect } from "effect"

export class WorkspaceCompilerError extends Data.TaggedError("WorkspaceCompilerError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

export type NativeCompilerError = WorkspaceCompilerError

export const nativeRequest = <A>(
  operation: string,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, WorkspaceCompilerError> =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new WorkspaceCompilerError({ operation, cause }),
  })
