export type AccountModule = typeof import("../users/account.js")

export const loadAccount = () => import("../users/account.js")
