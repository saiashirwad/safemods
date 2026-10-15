import { createCharge } from "./charges.js"

export function collect(customerId: string, amountCents: number): ReadonlyArray<string> {
  return [createCharge({ customerId, amountCents }), createCharge({ customerId, amountCents: amountCents * 2, currency: "eur" })]
}

export function collectAll(batch: [string, number]): string {
  return createCharge(...batch)
}
