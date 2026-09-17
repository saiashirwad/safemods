export const loadAuth = () => import("@acme/sdk")
export const loadBilling = () => import('@acme/sdk')

export type SessionModule = typeof import("@acme/sdk")
