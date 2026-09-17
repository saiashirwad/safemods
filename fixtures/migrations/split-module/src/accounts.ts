export interface Account {
  readonly id: string
  readonly email: string
}

export type AccountId = Account["id"]

const accounts = new Map<AccountId, Account>()

export const findAccount = (id: AccountId): Account | undefined => accounts.get(id)

export const saveAccount = (account: Account): void => {
  accounts.set(account.id, account)
}
