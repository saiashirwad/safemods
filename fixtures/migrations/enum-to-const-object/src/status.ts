/** Values returned by the public API. */
export enum Status {
  /** The request has not started. */
  Pending = "pending",
  // Kept stable for persisted records.
  Complete = "complete",
}

export const defaultStatus: Status = Status.Pending
