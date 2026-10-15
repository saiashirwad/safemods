import type { Account, AccountId } from "./model.js"

const accounts = new Map<AccountId, Account>()

export const findAccount = (id: AccountId): Account | undefined => accounts.get(id)

export const saveAccount = (account: Account): void => {
  accounts.set(account.id, account)
}

export const countAccounts = (): number => accounts.size
