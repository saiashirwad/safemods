export type AccountModule = typeof import("../identity/account.js")

export const loadAccount = () => import("../identity/account.js")
