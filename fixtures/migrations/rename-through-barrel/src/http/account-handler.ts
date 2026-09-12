import { loadAccount } from "../accounts/index.js"
import type { Account } from "../accounts/account.js"

export interface AccountRequest {
  readonly accountId: string
}

export interface AccountResponse {
  readonly id: string
  readonly email: string
  readonly status: Account["status"]
}

export const handleAccountShow  = (request: AccountRequest): Account =>
  loadAccount(request.accountId)

export function serializeAccount(accountId: string): AccountResponse {
  const account = loadAccount(accountId)
  return { id: account.id, email: account.email, status: account.status }
}
