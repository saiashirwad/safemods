export interface Account {
  readonly label: string
  readonly id: string
}

const displayName = "Ada"
export const primary: Account = { label: displayName, id: "acc_1" }
export const backup: Account = { label: "Grace", id: "acc_2" }
