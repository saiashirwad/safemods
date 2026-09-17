import type { Invoice } from "../billing/invoices.js"

export type AccountId = string & { readonly AccountId: unique symbol }

export interface UserAccount {
  readonly id: AccountId
  readonly email: string
  readonly displayName: string
  readonly plan: "trial" | Invoice["status"]
}

const toAccountId = (raw: string): AccountId => raw as AccountId

export const parseAccountId = (raw: string): AccountId | undefined => {
  if (!raw.startsWith("acct_")) return undefined
  return toAccountId(raw)
}

export const createAccount = (email: string, displayName: string): UserAccount => {
  const normalized = email.trim().toLowerCase()
  return {
    id: toAccountId(`acct_${normalized.replaceAll("@", "_")}`),
    email: normalized,
    displayName: displayName.trim(),
    plan: "trial",
  }
}

export const isActiveAccount = (account: UserAccount): boolean =>
  account.email.includes("@") && account.displayName.length > 0

export const withInvoicePlan = (account: UserAccount, invoice: Invoice): UserAccount => ({
  ...account,
  plan: invoice.status,
})
