import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { apiCompatibility } from "../../src/Checks/ApiCompatibility.ts"
import { comparedFindingsOf } from "../utils/check.ts"

const check = apiCompatibility({ within: "src/**" })

const API_BEFORE = [
  "export const send = (label: string): void => {}",
  "export const pad = (text: string, width: number): string => text.padStart(width)",
  "export const legacy = 1",
  "export const kept = (text: string) => text.trim()",
  "",
].join("\n")

const API_NOW = [
  "export const send = (label: number): void => {}",
  "export const pad = (text: string, width?: number): string => text.padStart(width ?? 0)",
  "export const kept = (text: string) => text.trimStart()",
  "",
].join("\n")

const MODEL = (size: string, weight: string) =>
  [
    "export interface Box {",
    `  readonly size: ${size}`,
    "}",
    "export interface Crate {",
    `  readonly weight${weight}: number`,
    "}",
    "",
  ].join("\n")

const SERVICE = (body: string) =>
  [
    'import type { Box } from "./model.js"',
    `export const make = (box: Box): Box => ${body}`,
    "export class Holder {",
    "  private hidden = 1",
    "  read(): number {",
    "    return this.hidden",
    "  }",
    "}",
    "",
  ].join("\n")

const SHAPES = (value: string) =>
  [
    "declare const cache: unique symbol",
    "export interface Table {",
    `  readonly [key: string]: ${value}`,
    "}",
    "export interface Wide {",
    "  readonly a: string",
    "  readonly b: string",
    `  readonly c: ${value}`,
    "  readonly [cache]: number",
    "}",
    "export interface Held {",
    "  readonly [cache]: string",
    "}",
    "",
  ].join("\n")

describe("api-compatibility", () => {
  effect("reports a changed parameter, an optional parameter and a removed export", () =>
    Effect.gen(function* () {
      const findings = yield* comparedFindingsOf(
        check,
        { "src/api.ts": API_NOW },
        { "src/api.ts": API_BEFORE },
      )
      expect(findings).toEqual([
        "src/api.ts:1:1 api-compatibility removed export legacy",
        "src/api.ts:1:14 api-compatibility breaking change to export send: was (label: string) => void, now (label: number) => void",
        "src/api.ts:2:14 api-compatibility widened export pad, so old uses still typecheck: was (text: string, width: number) => string, now (text: string, width?: number | undefined) => string",
      ])
    }),
  )

  effect("reports each changed interface once, where it is declared, and leaves ripple alone", () =>
    Effect.gen(function* () {
      const findings = yield* comparedFindingsOf(
        check,
        {
          "src/model.ts": MODEL("string", "?"),
          "src/service.ts": SERVICE("({ ...box })"),
          "src/index.ts":
            'export type { Box } from "./model.js"\nexport { make } from "./service.js"\n',
        },
        {
          "src/model.ts": MODEL("number", ""),
          "src/service.ts": SERVICE("box"),
          "src/index.ts": 'export type { Box } from "./model.js"\n',
        },
      )
      expect(findings).toEqual([
        "src/model.ts:1:1 api-compatibility breaking change to export Box: changed size (was number, now string)",
        "src/model.ts:4:1 api-compatibility breaking change to export Crate: changed weight (was number, now optional number | undefined)",
      ])
    }),
  )

  effect("reports a barrel that dropped a name, a deleted file and a type-only change", () =>
    Effect.gen(function* () {
      const findings = yield* comparedFindingsOf(
        check,
        {
          "src/tag.ts": 'export const tag = "t"\n',
          "src/index.ts": 'export { tag as label } from "./tag.js"\n',
          "src/ids.ts": "export type Id = number\nexport type Loader = (retries: number) => Id\n",
        },
        {
          "src/index.ts": 'export { tag } from "./tag.js"\n',
          "src/ids.ts": "export type Id = string\nexport type Loader = () => Id\n",
          "src/gone.ts": "export const gone = 1\n",
        },
      )
      expect(findings).toEqual([
        "src/ids.ts:1:1 api-compatibility breaking change to export Id: was string, now number",
        "src/ids.ts:2:1 api-compatibility breaking change to export Loader: was () => string, now (retries: number) => number",
        "src/index.ts:1:1 api-compatibility removed export tag",
        "tsconfig.json:1:1 api-compatibility removed export gone, and src/gone.ts is gone",
      ])
    }),
  )

  effect("names an index signature and only the members that differ, ignoring symbol ids", () =>
    Effect.gen(function* () {
      const findings = yield* comparedFindingsOf(
        check,
        { "src/shapes.ts": SHAPES("number") },
        { "src/shapes.ts": SHAPES("string") },
      )
      expect(findings).toEqual([
        "src/shapes.ts:2:1 api-compatibility breaking change to export Table: changed [key: string] (was string, now number)",
        "src/shapes.ts:5:1 api-compatibility breaking change to export Wide: changed c (was string, now number)",
      ])
    }),
  )

  effect("leaves a changed file outside the glob alone", () =>
    Effect.gen(function* () {
      const findings = yield* comparedFindingsOf(
        apiCompatibility({ within: "src/inside/**" }),
        {
          "src/inside/kept.ts": "export type Id = number\n",
          "src/outside/dropped.ts": "export type Id = number\n",
        },
        {
          "src/inside/kept.ts": "export type Id = string\n",
          "src/outside/dropped.ts": "export type Id = string\n",
        },
      )
      expect(findings).toEqual([
        "src/inside/kept.ts:1:1 api-compatibility breaking change to export Id: was string, now number",
      ])
    }),
  )
})
