import { createHash } from "node:crypto"

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

export const hashDirectoryListing = (names: ReadonlyArray<string>): string =>
  sha256(JSON.stringify([...names].sort()))
