import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { anyInPublicApi } from "../../src/Checks/AnyInPublicApi.ts"
import { findingsOf } from "../utils/check.ts"

describe("namespace public APIs", () => {
  effect("checks nested inline namespace exports without publishing private members", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(anyInPublicApi({ publicApi: ["src/index.ts"] }), {
        "src/index.ts": [
          "export namespace API {",
          "  export const loose = (input: any): number => input",
          "  const hidden = (input: any): number => input",
          "  export namespace Nested {",
          "    export interface Payload { value: any }",
          "    export const strict = (input: string): string => input",
          "  }",
          "}",
          "namespace Private { export const hidden: any = 1 }",
          "",
        ].join("\n"),
      })
      expect(findings).toEqual([
        "src/index.ts:2:16 any-in-public-api loose is public and its type contains any: callers lose checking through it",
        "src/index.ts:5:5 any-in-public-api Payload is public and its type contains any: callers lose checking through it",
      ])
    }),
  )

  effect("follows type-only namespace exports and cyclic namespace re-exports once", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(anyInPublicApi({ publicApi: ["src/index.ts"] }), {
        "src/index.ts": 'export * as API from "./api.js"\n',
        "src/api.ts": [
          'export * as Again from "./index.js"',
          "export namespace Types {",
          "  export type Loose = { value: any }",
          "  export type Strict = { value: string }",
          "}",
          "",
        ].join("\n"),
        "src/private.ts": "export namespace Hidden { export type Loose = any }\n",
      })
      expect(findings).toEqual([
        "src/api.ts:3:3 any-in-public-api Loose is public and its type contains any: callers lose checking through it",
      ])
    }),
  )
})
