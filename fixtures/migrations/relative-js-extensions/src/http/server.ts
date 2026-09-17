import { signup } from './routes'
import { /* keep this comment */ createSession } from "../auth/session"
import { registerUser } from "../users/directory.js"

export interface HttpRequest {
  readonly method: string
  readonly path: string
  readonly email?: string
  readonly displayName?: string
}

export interface HttpResponse {
  readonly status: number
  readonly body: unknown
}

export const handleRequest = (request: HttpRequest): HttpResponse => {
  if (request.method !== "POST" || request.path !== "/signup") {
    return { status: 404, body: { error: "not-found" } }
  }
  const email = request.email ?? "owner@example.com"
  const displayName = request.displayName ?? "Owner"
  const actor = registerUser(email, displayName)
  const session = createSession(actor.id)
  const result = signup(email, displayName, session)
  return { status: result.ok ? 201 : 401, body: result }
}

export interface ListeningServer {
  readonly port: number
  readonly handle: (request: HttpRequest) => HttpResponse
}

export const listen  = (port: number): ListeningServer => ({
  port,
  handle: handleRequest,
})
