export const Status = { Pending: "pending", Done: "done" } as const
export const Limits = { retries: 3, timeout: 1000 } as const
export const Mixed = { name: "mixed", handler: () => 1 }
export const Typed: Record<string, string> = { a: "a" }
export const Frozen = { a: "a" } as const
const Local = { a: "a" }
export const localKeys = Object.keys(Local)
