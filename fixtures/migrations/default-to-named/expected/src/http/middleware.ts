import { authenticate } from "../auth/index.js"
import type { Credentials, Session } from "../auth/session.js"

export interface AuthorizedRequest {
  readonly credentials: Credentials
  readonly session: Session
}

export function requireSession(credentials: Credentials): AuthorizedRequest {
  const session = authenticate(credentials)
  if (session.token.length === 0) {
    throw new Error("authenticate returned an empty token")
  }
  return { credentials, session }
}
