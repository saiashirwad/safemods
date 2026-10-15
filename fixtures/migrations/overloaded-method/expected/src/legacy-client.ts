export interface LookupOptions {
  readonly fresh?: boolean
}

export interface Result {
  readonly value: string
}

export function lookup(key: string): Promise<Result>
export function lookup(key: string, options: LookupOptions): Promise<Result>
export function lookup(
  key: string,
  callback: (error: Error | null, result?: Result) => void,
): void
export function lookup(
  key: string,
  options: LookupOptions,
  callback: (error: Error | null, result?: Result) => void,
): void
export function lookup(
  _key: string,
  _options?: LookupOptions | ((error: Error | null, result?: Result) => void),
  _callback?: (error: Error | null, result?: Result) => void,
): Promise<Result> | void {
  return Promise.resolve({ value: "fixture" })
}

export const client = { lookup }
