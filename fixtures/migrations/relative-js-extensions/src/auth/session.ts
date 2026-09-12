export const SESSION_TTL_MS = 1000 * 60 * 60 * 12

export interface Session {
  readonly id: string
  readonly userId: string
  readonly issuedAt: Date
  readonly expiresAt: Date
}

export const createSession = (userId: string, now = new Date()): Session => {
  const issuedAt = now
  return {
    id: `${userId}:${issuedAt.getTime()}`,
    userId,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + SESSION_TTL_MS),
  }
}

export const verifySession = (session: Session, now = new Date()): boolean =>
  session.expiresAt.getTime() > now.getTime() && session.userId.length > 0

export const refreshSession = (session: Session, now = new Date()): Session =>
  createSession(session.userId, now)
