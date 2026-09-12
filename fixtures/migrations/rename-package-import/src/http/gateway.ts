import { createClient as connectAcme, type AcmeClient, type ClientConfig } from "@acme/legacy-client"

const productionConfig: ClientConfig = {
  baseUrl: "https://api.acme.example",
  apiKey: "dev-key",
  timeoutMs: 8_000,
}

let cached: AcmeClient | undefined

export const getAcmeClient = (): AcmeClient => {
  cached ??= connectAcme(productionConfig)
  return cached
}

export const withClient = async <A>(use: (client: AcmeClient) => Promise<A>): Promise<A> =>
  use(getAcmeClient())

export const countOpenInvoices = async (customerId: string): Promise<number> => {
  const invoices = await getAcmeClient().billing.listInvoices(customerId)
  return invoices.filter((invoice) => invoice.status === "open").length
}
