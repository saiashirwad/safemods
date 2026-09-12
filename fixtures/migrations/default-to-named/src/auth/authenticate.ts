import { AuthenticationError, type Credentials, type Session } from "./session.js"

export const AUTH_SCHEME = "session" as const

const TOKEN_TTL_MS = 60 * 60 * 1000

function mintToken(userId: string, issuedAt: number): string {
  return `${AUTH_SCHEME}_${userId.slice(0, 8)}_${issuedAt.toString(36)}`
}

/**
 * Verify credentials and issue a session token.
 * Keep this JSDoc attached to the export.
 */
export default function authenticate(credentials: Credentials): Session {
  if (credentials.email.length === 0) {
    throw new AuthenticationError("email is required")
  }
  if (credentials.password.length < 8) {
    throw new AuthenticationError("password too short")
  }

  const issuedAt = Date.now()
  const userId = credentials.email.toLowerCase()
  return {
    userId,
    token: mintToken(userId, issuedAt),
    expiresAt: new Date(issuedAt + TOKEN_TTL_MS),
  }
}
