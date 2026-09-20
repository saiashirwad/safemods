export interface ChargeOptions {
  readonly customerId: string
  readonly amountCents: number
  readonly currency?: string
}

export function createCharge(customerId: string, amountCents: number, currency?: string): string
export function createCharge(options: ChargeOptions): string
export function createCharge(
  customerIdOrOptions: string | ChargeOptions,
  amountCents?: number,
  currency?: string,
): string {
  const options: ChargeOptions =
    typeof customerIdOrOptions === "string"
      ? { customerId: customerIdOrOptions, amountCents: amountCents ?? 0, currency }
      : customerIdOrOptions
  return `${options.customerId}:${String(options.amountCents)}:${options.currency ?? "usd"}`
}
