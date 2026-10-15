import { createHash } from "node:crypto"

export interface AuditEvent {
  readonly kind: "session" | "invoice" | "user-lookup"
  readonly actorId: string
  readonly payload: string
}

export const fingerprintEvent = (event: AuditEvent): string =>
  createHash("sha256")
    .update(event.kind)
    .update(event.actorId)
    .update(event.payload)
    .digest("hex")

export const formatAuditLine = (event: AuditEvent): string => {
  const digest = fingerprintEvent(event)
  return `${event.kind} actor=${event.actorId} sha256=${digest}`
}
