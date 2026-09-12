import type { DirectoryUser } from '../users/directory'

export interface InvoiceLine {
  readonly description: string
  readonly amountCents: number
}

export interface Invoice {
  readonly id: string
  readonly customerId: string
  readonly currency: "usd"
  readonly lines: ReadonlyArray<InvoiceLine>
  readonly issuedAt: Date
}

export const createInvoice = (
  customer: DirectoryUser,
  lines: ReadonlyArray<InvoiceLine>,
  issuedAt = new Date(),
): Invoice => ({
  id: `inv_${customer.id}_${issuedAt.getTime()}`,
  customerId: customer.id,
  currency: "usd",
  lines,
  issuedAt,
})

export const invoiceTotalCents = (invoice: Invoice): number =>
  invoice.lines.reduce((total, line) => total + line.amountCents, 0)

export const isPayable = (invoice: Invoice): boolean =>
  invoice.lines.length > 0 && invoiceTotalCents(invoice) > 0
