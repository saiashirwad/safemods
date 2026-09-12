import { /* rotate keys before 2026-10-01 */ createClient, type SessionToken } from "@acme/legacy-client"

export interface IssuedSession {
  readonly token: SessionToken
  readonly issuedAt: string
}

export const issueSession = async (email: string, password: string): Promise<IssuedSession> => {
  const client = createClient({
    baseUrl: "https://api.acme.example",
    apiKey: "dev-key",
  })
  const token = await client.auth.createSession(email, password)
  return { token, issuedAt: new Date().toISOString() }
}

// This comment and the unusual spacing are source-fidelity sentinels.
export const  revokeForUser  = async (token: string): Promise<void> => {
  const client = createClient({
    baseUrl: "https://api.acme.example",
    apiKey: "dev-key",
  })
  await client.auth.revokeSession(token)
}
