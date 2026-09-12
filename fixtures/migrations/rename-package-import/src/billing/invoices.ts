import { createClient, type Invoice } from '@acme/legacy-client'
import { formatAuditLine } from "../audit/logger.js"

export interface InvoiceSummary {
  readonly id: string
  readonly customerId: string
  readonly amountCents: number
  readonly status: Invoice["status"]
}

export const listOpenInvoices = async (
  customerId: string,
): Promise<ReadonlyArray<InvoiceSummary>> => {
  const client = createClient({
    baseUrl: "https://api.acme.example",
    apiKey: "dev-key",
  })
  const invoices = await client.billing.listInvoices(customerId)
  return invoices
    .filter((invoice) => invoice.status === "open")
    .map((invoice) => ({
      id: invoice.id,
      customerId: invoice.customerId,
      amountCents: invoice.amountCents,
      status: invoice.status,
    }))
}

export const describeInvoice = (customerId: string, invoice: Invoice): string =>
  formatAuditLine({
    kind: "invoice",
    actorId: customerId,
    payload: `${invoice.id}:${invoice.amountCents}`,
  })

export const voidInvoice = async (invoiceId: string): Promise<Invoice> => {
  const client = createClient({
    baseUrl: "https://api.acme.example",
    apiKey: "dev-key",
  })
  return client.billing.voidInvoice(invoiceId)
}
