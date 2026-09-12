import { verifySession as requireSession, type Session } from "../auth/session"
import { attachSession, registerUser, type DirectoryUser } from "../users/directory"
import { createInvoice, invoiceTotalCents, type Invoice } from "../billing/invoices"

export interface AuthenticatedRequest {
  readonly session: Session
  readonly actor: DirectoryUser
}

export const authenticate = (
  session: Session,
  actor: DirectoryUser,
): AuthenticatedRequest | undefined => {
  if (!requireSession(session)) {
    return undefined
  }
  return { session, actor: attachSession(actor, session) }
}

export const issueWelcomeInvoice = (actor: DirectoryUser): Invoice =>
  createInvoice(actor, [{ description: "workspace seat", amountCents: 1200 }])

export const signup = (email: string, displayName: string, session: Session) => {
  const actor = registerUser(email, displayName)
  const request = authenticate(session, actor)
  if (request === undefined) {
    return { ok: false as const, reason: "expired-session" }
  }
  const invoice = issueWelcomeInvoice(request.actor)
  return {
    ok: true as const,
    actor: request.actor,
    invoiceId: invoice.id,
    totalCents: invoiceTotalCents(invoice),
  }
}
