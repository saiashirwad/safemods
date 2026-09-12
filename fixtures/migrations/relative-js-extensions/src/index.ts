import { listen } from "./http/server"
import { createSession } from "./auth/index"
import type { Session } from "./auth/session"
import { info } from "./telemetry/logger.js"

export const startBillingApi  = (port = 8787) => {
  const bootstrap: Session = createSession("bootstrap")
  const server = { ...listen(port), bootstrapSessionId: bootstrap.id }
  return { ...server, started: info("billing api listening", { port: server.port }) }
}

export const loadLedger = () => import("./billing/ledger")
