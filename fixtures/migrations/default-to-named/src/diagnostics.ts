import { appConfig } from "./config.js"

// Deliberate baseline error: verification should reject only a diagnostic regression.
export const servicePort: string = 8080

export function describeService(): string {
  return `${appConfig.serviceName} listens on ${servicePort}`
}
