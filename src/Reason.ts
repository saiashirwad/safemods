export const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)
