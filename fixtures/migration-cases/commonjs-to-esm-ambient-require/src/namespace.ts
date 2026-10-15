export namespace global {
  export function require(id: string): string { return id }
  export const loaded = require("local")
}
