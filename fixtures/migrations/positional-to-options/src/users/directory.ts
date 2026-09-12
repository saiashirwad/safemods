export interface DirectoryEntry {
  readonly userId: string
  readonly displayName: string
  readonly active: boolean
}

export interface DirectoryGrant {
  readonly token: string
  readonly userId: string
  readonly ttlSeconds: number
}

function createSession(userId: string, ttlSeconds: number): string {
  return `dir_${userId}_${String(ttlSeconds)}`
}

export function issueDirectoryGrant(entry: DirectoryEntry, ttlSeconds: number): DirectoryGrant {
  if (!entry.active) {
    throw new Error(`Directory entry ${entry.userId} is inactive`)
  }
  return {
    token: createSession(entry.userId, ttlSeconds),
    userId: entry.userId,
    ttlSeconds,
  }
}
