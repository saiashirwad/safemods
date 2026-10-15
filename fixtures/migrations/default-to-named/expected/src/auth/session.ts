export interface Credentials {
  readonly email: string
  readonly password: string
}

export interface Session {
  readonly userId: string
  readonly token: string
  readonly expiresAt: Date
}

export class AuthenticationError extends Error {
  readonly _tag = "AuthenticationError"

  constructor(readonly reason: string) {
    super(`authentication failed: ${reason}`)
    this.name = "AuthenticationError"
  }
}

export function isSessionExpired(session: Session, now = new Date()): boolean {
  return session.expiresAt.getTime() <= now.getTime()
}
