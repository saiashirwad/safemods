export type AccountStatus = "active" | "suspended" | "closed"

export interface Account {
  readonly id: string
  readonly email: string
  readonly status: AccountStatus
  readonly openedAt: Date
}

export class AccountNotFound extends Error {
  readonly _tag = "AccountNotFound"

  constructor(readonly accountId: string) {
    super(`Account ${accountId} was not found`)
    this.name = "AccountNotFound"
  }
}

export const isBillable = (account: Account): boolean => account.status === "active"
