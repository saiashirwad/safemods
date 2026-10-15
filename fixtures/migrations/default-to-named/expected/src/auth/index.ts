export type { Credentials, Session } from "./session.js"
export { AuthenticationError, isSessionExpired } from "./session.js"
// Public authenticate entry used by HTTP middleware.
export { authenticate } from "./authenticate.js"
