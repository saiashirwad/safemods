export interface TokenRequest {
  readonly subject: string
  readonly scope: number
}

export function issueToken(userId: string, scope: string): string
export function issueToken(request: TokenRequest): string
export function issueToken(userIdOrRequest: string | TokenRequest, scope?: string): string {
  return typeof userIdOrRequest === "string"
    ? `${userIdOrRequest}:${scope ?? ""}`
    : `${userIdOrRequest.subject}:${String(userIdOrRequest.scope)}`
}

export const guestToken = issueToken("guest", "read")
