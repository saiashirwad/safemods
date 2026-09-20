import { type Account, backup, primary as account } from "./account.js"

export const direct = account.displayName
export const optional = (value: Account | undefined) => value?.displayName
export const preservedLocal = ({ displayName }: Account) => displayName
export const existingAlias = ({ displayName: label }: Account) => label
export const copied: Account = { displayName: account.displayName, id: account.id }
export const shorthand = (displayName: string): Account => ({ displayName, id: "acc_3" })
interface Other { displayName: string }
const unrelated: Other = { displayName: "unrelated" }
export const other = unrelated.displayName
export const otherLocal = ({ displayName }: Other) => displayName
const headers: Record<string, string> = { displayName: "header" }
export const header = headers.displayName

// Computed property references are deliberately reported rather than guessed at.
export const computed = (backup as unknown as Record<string, string>)["displayName"]
