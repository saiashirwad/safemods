export interface Account {
  readonly displayName: string
  readonly id: string
}

const displayName = "Ada"
export const primary: Account = { displayName, id: "acc_1" }
export const backup: Account = { displayName: "Grace", id: "acc_2" }
