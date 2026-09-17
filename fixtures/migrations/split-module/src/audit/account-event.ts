import type { Account, AccountId } from "../accounts.js"

export interface AccountEvent {
  readonly accountId: AccountId
  readonly snapshot: Account
}
