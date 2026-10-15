import { createSession } from "./auth/index.js"
import { local } from "./config.local.js"
import { gone } from "./missing"
export const extra = [createSession, local, gone]
