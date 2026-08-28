import { Data } from "effect"

export class ApplicationFailure extends Data.TaggedError("ApplicationFailure")<{
  readonly planId: string
  readonly cause: unknown
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
