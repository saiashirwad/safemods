import { hash } from "node:crypto"

export const sha256 = (value: string): string => hash("sha256", value, "hex")
