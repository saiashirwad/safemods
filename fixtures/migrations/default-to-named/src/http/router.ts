import /* keep this comment */ signIn from '../auth/authenticate.js'
import type { Credentials } from "../auth/session.js"
import renderInvoice, { type Invoice } from "../billing/invoice.js"
import { openAccount } from "../users/account.js"

export interface HttpRequest {
  readonly method: "GET" | "POST"
  readonly path: string
  readonly body: unknown
}

export interface HttpResponse {
  readonly status: number
  readonly body: string
}

function asCredentials(body: unknown): Credentials {
  if (
    typeof body !== "object" ||
    body === null ||
    !("email" in body) ||
    !("password" in body) ||
    typeof body.email !== "string" ||
    typeof body.password !== "string"
  ) {
    throw new Error("invalid credentials payload")
  }
  return { email: body.email, password: body.password }
}

export function handleLogin(request: HttpRequest): HttpResponse {
  const credentials = asCredentials(request.body)
  // Unusual spacing is a source-fidelity sentinel.
  const session  = signIn(credentials)
  const account = openAccount(credentials)
  return {
    status: 200,
    body: JSON.stringify({ token: session.token, accountId: account.id }),
  }
}

export function handleInvoice(invoice: Invoice): HttpResponse {
  return {
    status: 200,
    body: renderInvoice(invoice),
  }
}
