import {
  login as authenticate,
  logout,
  type LoginOptions,
  type Session as UserSession,
} from "@acme/sdk"

export const openSession = (options: LoginOptions): Promise<UserSession> => authenticate(options)
export const closeSession = logout
