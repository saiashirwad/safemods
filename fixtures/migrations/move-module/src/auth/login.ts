import { createAccount, type UserAccount } from "../users/index.js"

export interface SignupRequest {
  readonly email: string
  readonly displayName: string
}

export const completeSignup = (request: SignupRequest): UserAccount =>
  createAccount(request.email, request.displayName)
