import { createSession, type Session } from "../sessions.js"

const LOGIN_TTL_SECONDS = 60 * 30
const IMPERSONATION_TTL_SECONDS = 60 * 15

export interface AccountRecord {
  readonly userId: string
  readonly email: string
  readonly locked: boolean
}

export interface LoginResult {
  readonly session: Session
  readonly email: string
}

export function login(account: AccountRecord): LoginResult {
  if (account.locked) {
    throw new Error(`Account ${account.email} is locked`)
  }

  const session = createSession(account.userId, LOGIN_TTL_SECONDS)
  return { session, email: account.email }
}

export function impersonate(operatorId: string, targetUserId: string): Session {
  if (operatorId === targetUserId) {
    throw new Error("Impersonation requires a distinct operator")
  }
  return createSession(targetUserId, IMPERSONATION_TTL_SECONDS)
}
