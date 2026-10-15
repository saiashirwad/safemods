import { inspect } from "node:util"

export type LogLevel = "debug" | "info" | "error"

export interface LogEvent {
  readonly level: LogLevel
  readonly message: string
  readonly at: Date
  readonly detail?: unknown
}

export const formatEvent = (event: LogEvent): string => {
  const head = `${event.at.toISOString()} [${event.level}] ${event.message}`
  if (event.detail === undefined) {
    return head
  }
  return `${head} ${inspect(event.detail, { depth: 3, colors: false })}`
}

export const info = (message: string, detail?: unknown): LogEvent => ({
  level: "info",
  message,
  at: new Date(),
  detail,
})
