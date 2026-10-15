import type { Account, AccountId } from "../accounts/model.js"

export interface AccountEvent {
  readonly accountId: AccountId
  readonly snapshot: Account
}
