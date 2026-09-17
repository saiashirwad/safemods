export type LedgerAccountId = string & { readonly LedgerAccountId: unique symbol }

export interface LedgerAccount {
  readonly id: LedgerAccountId
  readonly currency: "USD" | "EUR"
  readonly balanceCents: number
}

export const openLedgerAccount = (
  currency: LedgerAccount["currency"],
): LedgerAccount => ({
  id: `led_${currency}_0001` as LedgerAccountId,
  currency,
  balanceCents: 0,
})

export const credit = (account: LedgerAccount, amountCents: number): LedgerAccount => ({
  ...account,
  balanceCents: account.balanceCents + amountCents,
})
