export interface InvoiceLine {
  readonly description: string
  readonly amountCents: number
}

export interface Invoice {
  readonly id: string
  readonly customerId: string
  readonly lines: ReadonlyArray<InvoiceLine>
}

export function invoiceTotal(invoice: Invoice): number {
  let total = 0
  for (const line of invoice.lines) {
    total += line.amountCents
  }
  return total
}

/** Billing keeps its own default export; the recipe must not touch it. */
export default function renderInvoice(invoice: Invoice): string {
  const header = `Invoice ${invoice.id} for ${invoice.customerId}`
  const body = invoice.lines
    .map((line) => `- ${line.description}: ${line.amountCents}`)
    .join("\n")
  return `${header}\n${body}\nTotal: ${invoiceTotal(invoice)}`
}
