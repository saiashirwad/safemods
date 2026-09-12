export interface RequestPrincipal {
  readonly userId: string
  readonly roles: ReadonlyArray<string>
}

export interface IncomingRequest {
  readonly method: string
  readonly path: string
  readonly principal: RequestPrincipal | undefined
}
