import { createSession, type Session } from '../sessions.js'

const INVOICE_TTL_SECONDS = 60 * 45

export interface InvoiceDraft {
  readonly invoiceId: string
  readonly customerId: string
  readonly amountCents: number
}

export function openInvoiceWorkspace(draft: InvoiceDraft): Session {
  return createSession({
    userId: draft.customerId,
    ttlSeconds: INVOICE_TTL_SECONDS,
  })
}
