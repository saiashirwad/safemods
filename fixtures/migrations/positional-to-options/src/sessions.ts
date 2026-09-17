export interface Session {
  readonly id: string
  readonly userId: string
  readonly createdAt: Date
  readonly expiresAt: Date
}

export interface CreateSessionOptions {
  readonly userId: string
  readonly ttlSeconds: number
}

let nextSessionId = 1

export function createSession(userId: string, ttlSeconds: number): Session
export function createSession(options: CreateSessionOptions): Session
export function createSession(
  userIdOrOptions: string | CreateSessionOptions,
  ttlSeconds?: number,
): Session {
  const options: CreateSessionOptions =
    typeof userIdOrOptions === "string"
      ? { userId: userIdOrOptions, ttlSeconds: ttlSeconds ?? 0 }
      : userIdOrOptions

  if (options.userId.length === 0) {
    throw new Error("createSession requires a userId")
  }
  if (options.ttlSeconds <= 0) {
    throw new Error("createSession requires a positive ttlSeconds")
  }

  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + options.ttlSeconds * 1000)
  const id = `sess_${String(nextSessionId)}`
  nextSessionId += 1
  return { id, userId: options.userId, createdAt, expiresAt }
}
