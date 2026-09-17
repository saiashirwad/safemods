export interface ClientConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly timeoutMs?: number
}

export interface SessionToken {
  readonly token: string
  readonly expiresAt: string
  readonly userId: string
}

export interface Invoice {
  readonly id: string
  readonly customerId: string
  readonly amountCents: number
  readonly currency: "USD" | "EUR"
  readonly status: "draft" | "open" | "paid" | "void"
}

export interface UserRecord {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly role: "admin" | "member" | "billing"
}

export interface AcmeClient {
  readonly auth: {
    readonly createSession: (email: string, password: string) => Promise<SessionToken>
    readonly revokeSession: (token: string) => Promise<void>
  }
  readonly billing: {
    readonly listInvoices: (customerId: string) => Promise<ReadonlyArray<Invoice>>
    readonly voidInvoice: (invoiceId: string) => Promise<Invoice>
  }
  readonly users: {
    readonly getById: (userId: string) => Promise<UserRecord>
    readonly search: (query: string) => Promise<ReadonlyArray<UserRecord>>
  }
}

export declare function createClient(config: ClientConfig): AcmeClient

// Ordinary string literals, not import/export specifiers — the recipe must leave these alone.
export const packageNames = {
  legacy: "@acme/legacy-client",
  current: "@acme/client",
} as const
