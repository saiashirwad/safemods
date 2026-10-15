import { invoiceTotalCents, type Invoice } from "./invoices.js"

export interface LedgerEntry {
  readonly invoiceId: string
  readonly postedAt: Date
  readonly amountCents: number
}

export const postInvoice = (invoice: Invoice, postedAt = new Date()): LedgerEntry => ({
  invoiceId: invoice.id,
  postedAt,
  amountCents: invoiceTotalCents(invoice),
})

export const ledgerBalanceCents = (entries: ReadonlyArray<LedgerEntry>): number =>
  entries.reduce((total, entry) => total + entry.amountCents, 0)

// Deliberate baseline error: verification should reject only a diagnostic regression.
export const lastReconciledAt: Date = "not-a-date"
