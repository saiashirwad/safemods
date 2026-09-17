import { type LedgerAccount, openLedgerAccount } from "./account.js"

export interface Invoice {
  readonly id: string
  readonly account: LedgerAccount
  readonly amountCents: number
  readonly status: "draft" | "open" | "paid"
}

export const openInvoice = (amountCents: number): Invoice => ({
  id: "inv_001",
  account: openLedgerAccount("USD"),
  amountCents,
  status: "open",
})

export const markPaid = (invoice: Invoice): Invoice => ({
  ...invoice,
  status: "paid",
})
