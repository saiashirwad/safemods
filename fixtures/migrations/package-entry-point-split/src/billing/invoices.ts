import { listInvoices as fetchInvoices, type Invoice, type ListInvoicesOptions } from '@acme/sdk'

export const loadInvoices = (options: ListInvoicesOptions): Promise<ReadonlyArray<Invoice>> =>
  fetchInvoices(options)
