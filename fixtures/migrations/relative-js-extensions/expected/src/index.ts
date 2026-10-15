import { listen } from "./http/server.js"
import { createSession } from "./auth/index.js"
import type { Session } from "./auth/session.js"
import { info } from "./telemetry/logger.js"

export const startBillingApi  = (port = 8787) => {
  const bootstrap: Session = createSession("bootstrap")
  const server = { ...listen(port), bootstrapSessionId: bootstrap.id }
  return { ...server, started: info("billing api listening", { port: server.port }) }
}

export const loadLedger = () => import("./billing/ledger.js")
