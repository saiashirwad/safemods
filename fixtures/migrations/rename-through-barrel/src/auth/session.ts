import { lookupAccount } from "../accounts/index.js"

export interface Session {
  readonly accountId: string
  readonly email: string
}

export function restoreSession(accountId: string): Session {
  const account = lookupAccount(accountId)
  return { accountId: account.id, email: account.email }
}
