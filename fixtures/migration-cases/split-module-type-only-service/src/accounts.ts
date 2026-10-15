export interface Account { readonly id: string; readonly email: string }
export type AccountId = string
export class AccountService {}
export const findAccount = (id: AccountId): Account | undefined => undefined
export const saveAccount = (account: Account): void => {}
