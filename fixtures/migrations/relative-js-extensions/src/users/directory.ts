import {
  displayNameFromEmail,
  normalizeEmail,
  profileIdForEmail,
  type UserProfile,
} from "./profile"
import type { Session } from "../auth/session.ts"

export interface DirectoryUser extends UserProfile {
  readonly lastSessionId?: string
}

export const registerUser = (email: string, displayName?: string): DirectoryUser => ({
  id: profileIdForEmail(email),
  email: normalizeEmail(email),
  displayName: displayName ?? displayNameFromEmail(email),
  createdAt: new Date(),
})

export const attachSession = (user: DirectoryUser, session: Session): DirectoryUser => ({
  ...user,
  lastSessionId: session.id,
})

export const findUserByEmail = (
  users: ReadonlyArray<DirectoryUser>,
  email: string,
): DirectoryUser | undefined => {
  const needle = normalizeEmail(email)
  return users.find((user) => user.email === needle)
}
