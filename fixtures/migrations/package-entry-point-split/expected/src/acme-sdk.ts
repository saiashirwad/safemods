export interface Session {
  readonly token: string
  readonly userId: string
}

export interface LoginOptions {
  readonly email: string
  readonly password: string
}

export interface Invoice {
  readonly id: string
  readonly amountCents: number
}

export interface ListInvoicesOptions {
  readonly customerId: string
}

export declare function login(options: LoginOptions): Promise<Session>
export declare function logout(token: string): Promise<void>
export declare function listInvoices(options: ListInvoicesOptions): Promise<ReadonlyArray<Invoice>>
export declare function voidInvoice(id: string): Promise<Invoice>
export declare const sdkVersion: string
