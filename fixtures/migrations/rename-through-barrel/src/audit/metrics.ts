export interface AuditCounters {
  readonly loginAttempts: number
  readonly failedLookups: number
}

export const emptyCounters: AuditCounters = {
  loginAttempts: 0,
  failedLookups: 0,
}

// Deliberate baseline error: a stored lag metric was typed as a string and never migrated.
export const auditLagSeconds: string = 15

export function recordFailure(counters: AuditCounters): AuditCounters {
  return {
    loginAttempts: counters.loginAttempts,
    failedLookups: counters.failedLookups + 1,
  }
}
