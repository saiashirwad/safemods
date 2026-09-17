import { type Account, type AccountId, findAccount, saveAccount } from "../accounts.js"

export const getAccount = (id: AccountId): Account | undefined => findAccount(id)

export const putAccount = (account: Account): void => saveAccount(account)
