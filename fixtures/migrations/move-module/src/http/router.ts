import { completeSignup } from "../auth/login.js"
import { register, toPublicProfile } from "./handlers.js"

export const handleSignup = (email: string, displayName: string) => {
  const fromAuth = completeSignup({ email, displayName })
  const fromHttp = register({
    email: fromAuth.email,
    displayName: fromAuth.displayName,
  })
  return toPublicProfile(fromHttp)
}
