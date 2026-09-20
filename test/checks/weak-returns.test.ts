import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { weakReturns } from "../../src/Checks/WeakReturns.ts"
import { findingsOf } from "../utils/check.ts"

describe("weak-returns", () => {
  effect(
    "sees inferred returns, imported aliases, promises and Effect success channels",
    () =>
      Effect.gen(function* () {
        const findings = yield* findingsOf(
          weakReturns({ within: "src/service.ts" }),
          {
            "src/aliases.ts": [
              "export type Payload = unknown",
              "export type Wrapped<T> = T extends string ? string : unknown",
              "",
            ].join("\n"),
            "src/service.ts": [
              'import { Effect } from "effect"',
              'import type { Payload, Wrapped } from "./aliases.js"',
              "export const inferredAny = (text: string) => JSON.parse(text)",
              "export async function promisedAny(url: string) {",
              "  return (await fetch(url)).json()",
              "}",
              "export function importedAlias(input: string): Payload {",
              "  return input",
              "}",
              "export function conditional(input: number): Wrapped<number> {",
              "  return input",
              "}",
              "export const optionalAny = (text: string) => (text === '' ? undefined : JSON.parse(text))",
              "export const effectOfAny = (text: string) => Effect.sync(() => JSON.parse(text))",
              "export const effectOfNumber = (text: string) => Effect.sync(() => text.length)",
              "export function precise(input: string): number {",
              "  return input.length",
              "}",
              "",
            ].join("\n"),
          },
          { dependencies: true },
        )
        expect(findings).toEqual([
          "src/service.ts:3:28 weak-returns returns any",
          "src/service.ts:4:1 weak-returns returns Promise<any>",
          "src/service.ts:7:1 weak-returns returns unknown",
          "src/service.ts:10:1 weak-returns returns unknown",
          "src/service.ts:13:28 weak-returns returns any",
          "src/service.ts:14:28 weak-returns returns Effect<any, never, never>",
          "src/service.ts:14:58 weak-returns returns any",
        ])
      }),
  )
})
