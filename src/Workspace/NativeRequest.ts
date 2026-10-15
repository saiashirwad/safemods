import { Data, Effect } from "effect"
import { reasonOf } from "../Reason.ts"

export class WorkspaceCompilerError extends Data.TaggedError("WorkspaceCompilerError")<{
  readonly operation: string
  readonly cause: unknown
}> {
  override readonly message = `The TypeScript compiler failed during ${this.operation}: ${
    reasonOf(this.cause)
  }`
}

export const nativeRequest = <A>(
  operation: string,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, WorkspaceCompilerError> =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new WorkspaceCompilerError({ operation, cause }),
  })
