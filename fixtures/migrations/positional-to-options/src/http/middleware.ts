import { createSession, type Session } from "../index.js"
import type { IncomingRequest } from "./request.js"

const COOKIE_TTL_SECONDS = 60 * 20

export function establishRequestSession(request: IncomingRequest): Session | undefined {
  const principal = request.principal
  if (principal === undefined) {
    return undefined
  }

  // Unusual spacing is a source-fidelity sentinel for this migration.
  const established  = createSession(/* request principal */ principal.userId, COOKIE_TTL_SECONDS)
  return established
}
