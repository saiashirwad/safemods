export interface WebhookEnvelope {
  readonly deliveryId: string
  readonly receivedAt: string
  readonly topic: "invoice.paid" | "user.updated"
}

export interface WebhookInbox {
  readonly lastDelivery: WebhookEnvelope
  readonly accepted: number
}

// Broker still sends numeric delivery ids; the envelope type expects a string.
export const inbox: WebhookInbox = {
  lastDelivery: {
    deliveryId: 4012,
    receivedAt: "2026-03-12T08:00:00.000Z",
    topic: "invoice.paid",
  },
  accepted: 17,
}

export const describeInbox = (): string =>
  `${inbox.lastDelivery.topic}#${inbox.lastDelivery.deliveryId} accepted=${inbox.accepted}`
