export interface AppConfig {
  readonly serviceName: string
  readonly sessionTtlMinutes: number
  readonly invoicePrefix: string
}

export const appConfig: AppConfig = {
  serviceName: "ledger-api",
  sessionTtlMinutes: 60,
  invoicePrefix: "inv",
}

export function configBanner(config: AppConfig): string {
  return `${config.serviceName} ttl=${config.sessionTtlMinutes}`
}
