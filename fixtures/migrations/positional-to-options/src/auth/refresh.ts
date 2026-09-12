import { createSession as openSession, type Session } from '../sessions.js'

const REFRESH_TTL_SECONDS = 60 * 60

export function refreshSession(userId: string, remainingTtl: number): Session {
  const ttlSeconds = remainingTtl > 0 ? remainingTtl : REFRESH_TTL_SECONDS
  return openSession(userId, ttlSeconds)
}
