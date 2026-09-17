import type { UserRecord } from "@acme/legacy-client"
import { getAcmeClient } from "../http/gateway.js"

export const findBillingAdmins = async (
  query: string,
): Promise<ReadonlyArray<UserRecord>> => {
  const users = await getAcmeClient().users.search(query)
  return users.filter((user) => user.role === "admin" || user.role === "billing")
}

export const requireUser = async (userId: string): Promise<UserRecord> =>
  getAcmeClient().users.getById(userId)

export const displayNameFor = (user: UserRecord): string =>
  `${user.displayName} <${user.email}>`
