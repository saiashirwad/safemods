import { type UserAccount, parseAccountId } from '../users/account.js'

export interface Session {
  readonly account: UserAccount
  readonly issuedAt: number
}

export const sessionFor = (account: UserAccount, issuedAt: number): Session => ({
  account,
  issuedAt,
})

export const sessionFromRawId = (
  raw: string,
  account: UserAccount,
  issuedAt: number,
): Session | undefined => {
  const id = parseAccountId(raw)
  if (id === undefined || id !== account.id) return undefined
  return sessionFor(account, issuedAt)
}
