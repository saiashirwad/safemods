export interface DirectoryEntry {
  readonly userId: string
  readonly displayName: string
  readonly email: string
}

const directory: ReadonlyArray<DirectoryEntry> = [
  { userId: "usr_ada", displayName: "Ada Lovelace", email: "ada@example.com" },
  { userId: "usr_grace", displayName: "Grace Hopper", email: "grace@example.com" },
]

/** Directory lookup. This is not the accounts-module loadAccount. */
export function loadAccount(userId: string): DirectoryEntry {
  const entry = directory.find((row) => row.userId === userId)
  if (entry === undefined) {
    throw new Error(`User ${userId} is not in the directory`)
  }
  return entry
}

export function displayNameFor(userId: string): string {
  return loadAccount(userId).displayName
}
