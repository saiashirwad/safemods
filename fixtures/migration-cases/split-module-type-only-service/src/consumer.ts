import { type AccountService, findAccount } from "./accounts.js"
export const consume = (service: AccountService) => findAccount('id')
