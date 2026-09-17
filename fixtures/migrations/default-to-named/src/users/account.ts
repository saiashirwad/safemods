import authenticate, { AUTH_SCHEME } from "../auth/authenticate.js"
import { isSessionExpired, type Credentials, type Session } from "../auth/session.js"

export interface UserAccount {
  readonly id: string
  readonly email: string
  readonly scheme: typeof AUTH_SCHEME
  readonly session: Session
}

export function openAccount(credentials: Credentials): UserAccount {
  const session = authenticate(credentials)
  if (isSessionExpired(session)) {
    throw new Error("issued session is already expired")
  }
  return {
    id: session.userId,
    email: credentials.email,
    scheme: AUTH_SCHEME,
    session,
  }
}
