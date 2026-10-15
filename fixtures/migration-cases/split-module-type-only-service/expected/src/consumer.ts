import { type AccountService, findAccount } from "./accounts/service.js"
export const consume = (service: AccountService) => findAccount('id')
