export interface Account {
  readonly id: string
  readonly email: string
}

export type AccountId = Account["id"]
