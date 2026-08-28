import { Data } from "effect"

export class ApplicationFailure extends Data.TaggedError("ApplicationFailure")<{
  readonly planId: string
  readonly cause: unknown
  readonly rolledBack: boolean
}> {}

export class ApplicationIndeterminate extends Data.TaggedError("ApplicationIndeterminate")<{
  readonly planId: string
  readonly cause: unknown
  readonly rollbackCause: unknown
}> {}

export interface ApplicationReceipt {
  readonly planId: string
  readonly snapshotHash: string
  readonly outputs: ReadonlyArray<{
    readonly projectId: string
    readonly fileName: string
    readonly hash: string
  }>
}
