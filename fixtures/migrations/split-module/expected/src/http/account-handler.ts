import type { Account, AccountId } from "../accounts/model.js"
import { findAccount, saveAccount } from "../accounts/service.js"

export const getAccount = (id: AccountId): Account | undefined => findAccount(id)

export const putAccount = (account: Account): void => saveAccount(account)
