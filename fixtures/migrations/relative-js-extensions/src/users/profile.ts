export interface UserProfile {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly createdAt: Date
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

export const profileIdForEmail = (email: string): string => {
  const normalized = normalizeEmail(email)
  return `usr_${normalized.replaceAll(/[^a-z0-9]+/g, "_")}`
}

export const displayNameFromEmail = (email: string): string => {
  const local = normalizeEmail(email).split("@")[0] ?? "member"
  return local.replaceAll(".", " ").replaceAll("_", " ")
}

export const isWorkspaceEmail = (email: string): boolean =>
  normalizeEmail(email).endsWith("@example.com")
