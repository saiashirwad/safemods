/** Values returned by the public API. */
export const Status = {
  /** The request has not started. */
  Pending: "pending",
  // Kept stable for persisted records.
  Complete: "complete"
} as const
export type Status = (typeof Status)[keyof typeof Status]

export const defaultStatus: Status = Status.Pending
