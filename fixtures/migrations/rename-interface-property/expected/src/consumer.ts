import { type Account, backup, primary as account } from "./account.js"

export const direct = account.label
export const optional = (value: Account | undefined) => value?.label
export const preservedLocal = ({ label: displayName }: Account) => displayName
export const existingAlias = ({ label: label }: Account) => label
export const copied: Account = { label: account.label, id: account.id }
export const shorthand = (displayName: string): Account => ({ label: displayName, id: "acc_3" })
interface Other { displayName: string }
const unrelated: Other = { displayName: "unrelated" }
export const other = unrelated.displayName
export const otherLocal = ({ displayName }: Other) => displayName
const headers: Record<string, string> = { displayName: "header" }
export const header = headers.displayName

// Computed property references are deliberately reported rather than guessed at.
export const computed = (backup as unknown as Record<string, string>)["displayName"]
