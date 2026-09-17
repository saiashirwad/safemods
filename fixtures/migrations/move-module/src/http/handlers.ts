import { /* keep this comment */ createAccount as provisionAccount, type UserAccount } from "../users/account.js"

export interface RegisterBody {
  readonly email: string
  readonly displayName: string
}

export const register  = (body: RegisterBody): UserAccount =>
  provisionAccount(body.email, body.displayName)

export const toPublicProfile = (
  account: UserAccount,
): { readonly email: string; readonly name: string } => ({
  email: account.email,
  name: account.displayName,
})
