import { createSession } from "./auth"
import { local } from "./config.local"
import { gone } from "./missing"
export const extra = [createSession, local, gone]
