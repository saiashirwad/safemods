import type { Session } from "./auth/session.js"
export const createSession = (userId: string, now = new Date()): Session => ({
  id: "wrong-target", userId, issuedAt: now, expiresAt: now,
})
