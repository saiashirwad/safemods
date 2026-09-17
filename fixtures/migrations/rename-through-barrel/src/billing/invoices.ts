import { /* billing still binds the public name */ loadAccount as fetchAccount } from '../accounts/store.js'
import type { Account } from "../accounts/account.js"

export interface Invoice {
  readonly id: string
  readonly accountId: string
  readonly cents: number
}

export function invoiceOwner(invoice: Invoice): Account {
  // Unusual spacing is a source-fidelity sentinel.
  const account  = fetchAccount(/* keep the billed-account comment */ invoice.accountId)
  return account
}

export function invoiceTotal(invoices: ReadonlyArray<Invoice>): number {
  return invoices.reduce((sum, invoice) => sum + invoice.cents, 0)
}

export function describeInvoice(invoice: Invoice): string {
  const owner = fetchAccount(invoice.accountId)
  return `${invoice.id} billed to ${owner.email}`
}
