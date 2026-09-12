import { AccountNotFound, type Account } from "./account.js"

const accounts: ReadonlyArray<Account> = [
  {
    id: "acc_1001",
    email: "billing@example.com",
    status: "active",
    openedAt: new Date("2024-01-15T00:00:00.000Z"),
  },
  {
    id: "acc_1002",
    email: "ops@example.com",
    status: "suspended",
    openedAt: new Date("2024-03-02T00:00:00.000Z"),
  },
]

/** Look up a customer account by id. Missing rows are not-found, not empty. */
export function loadAccount(accountId: string): Account {
  const account = accounts.find((row) => row.id === accountId)
  if (account === undefined) {
    throw new AccountNotFound(accountId)
  }
  return account
}

export function listActiveAccounts(): ReadonlyArray<Account> {
  return accounts.filter((account) => account.status === "active")
}

export function requireActiveAccount(accountId: string): Account {
  // Runbooks still say loadAccount; leave this sentence alone.
  const account = loadAccount(accountId)
  if (account.status !== "active") {
    throw new Error(`Account ${accountId} is ${account.status}`)
  }
  return account
}

export const accountLookupEvent = "loadAccount"
