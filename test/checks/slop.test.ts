import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import {
  duplicatedFunctions,
  ignoredReturns,
  unjustifiedCasts,
  unusedCode,
  unusedOptionalParameters,
} from "../../src/Checks/index.ts"
import { findingsOf } from "../utils/check.ts"

describe("slop rules", () => {
  effect("unjustified-casts reports trust, not casts the checker can already confirm", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(unjustifiedCasts({ within: "src/**" }), {
        "src/casts.ts": [
          "interface User { readonly name: string }",
          "interface Admin extends User { readonly level: number }",
          "declare const user: User",
          "declare const admin: Admin",
          "declare const raw: unknown",
          'export const parsed = JSON.parse("{}") as User',
          "export const trusted = raw as User",
          "export const narrowed = user as Admin",
          "export const unrelated = (user as unknown as number) + (42 as unknown as number)",
          "export const widened = admin as User",
          'export const literal = ["a"] as const',
          "export const stillUnknown = raw as unknown",
          "",
        ].join("\n"),
      })
      expect(findings).toEqual([
        "src/casts.ts:6:23 unjustified-casts asserts any as User without checking it: decode or narrow the value instead",
        "src/casts.ts:7:24 unjustified-casts asserts unknown as User without checking it: decode or narrow the value instead",
        "src/casts.ts:8:25 unjustified-casts narrows User to Admin on trust: use a guard, or give the source the narrower type",
        "src/casts.ts:9:27 unjustified-casts asserts unknown as number without checking it: decode or narrow the value instead",
        "src/casts.ts:9:57 unjustified-casts asserts unknown as number without checking it: decode or narrow the value instead",
      ])
    }),
  )

  effect("unused-code separates never used, test-only, used and public", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(
        unusedCode({ within: "src/**", tests: "test/**", publicApi: ["src/index.ts"] }),
        {
          "src/lib.ts": [
            "export const dead = (): number => 1",
            "export const testOnly = (): number => 2",
            "export const used = (): number => 3",
            "export const published = (): number => 4",
            "export interface DeadShape { readonly x: number }",
            "",
          ].join("\n"),
          "src/index.ts":
            'export { published } from "./lib.js"\nimport { used } from "./lib.js"\nexport const entry = used()\n',
          "test/lib.test.ts":
            'import { testOnly } from "../src/lib.js"\nexport const checked = testOnly()\n',
          "tsconfig.json": JSON.stringify({
            compilerOptions: {
              strict: true,
              module: "NodeNext",
              moduleResolution: "NodeNext",
              noEmit: true,
            },
            include: ["src/**/*.ts", "test/**/*.ts"],
          }),
        },
      )
      expect(findings).toEqual([
        "src/lib.ts:1:14 unused-code dead is never used: delete it",
        "src/lib.ts:2:14 unused-code testOnly is used only by tests: delete it with its tests, or make it part of the public API",
        "src/lib.ts:5:1 unused-code DeadShape is never used: delete it",
      ])
    }),
  )

  effect("unused-optional-parameters needs every caller to skip it, through any receiver", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(
        unusedOptionalParameters({ within: "src/**", publicApi: ["src/index.ts"] }),
        {
          "src/lib.ts": [
            "export const never = (a: number, retries = 3, label?: string): string => `${a}${retries}${label}`",
            "export const sometimes = (a: number, label?: string): string => `${a}${label}`",
            "export const spread = (a: number, label?: string): string => `${a}${label}`",
            "export const uncalled = (a: number, label?: string): string => `${a}${label}`",
            "export const published = (a: number, label?: string): string => `${a}${label}`",
            "export const wrapped = (a: number, label?: string): string => `${a}${label}`",
            "export const api = { wrapped }",
            "",
          ].join("\n"),
          "src/user.ts": [
            'import { api, never, published, sometimes, spread, wrapped } from "./lib.js"',
            "const args = [1] as const",
            'export const out = [never(1), never(2), wrapped(1), api.wrapped(2, "seen"), sometimes(1), sometimes(2, "x"), spread(...args), published(1)]',
            "",
          ].join("\n"),
          "src/index.ts": 'export { published } from "./lib.js"\n',
        },
      )
      expect(findings).toEqual([
        "src/lib.ts:1:14 unused-optional-parameters no caller passes label in 2 call(s): remove the parameter",
        "src/lib.ts:1:14 unused-optional-parameters no caller passes retries in 2 call(s): remove the parameter",
      ])
    }),
  )

  effect("ignored-returns needs every caller to drop a real value", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(ignoredReturns({ within: "src/**" }), {
        "src/lib.ts": [
          "const log: Array<number> = []",
          "export const push = (value: number): number => log.push(value)",
          "export const pushQuietly = (value: number): void => { log.push(value) }",
          "export const count = (value: number): number => log.push(value)",
          "export const fail = (reason: string): never => { throw new Error(reason) }",
          "export const once = (value: number): number => log.push(value)",
          "",
        ].join("\n"),
        "src/user.ts": [
          'import { count, fail, once, push, pushQuietly } from "./lib.js"',
          "push(1)",
          "push(2)",
          "pushQuietly(1)",
          "pushQuietly(2)",
          "count(1)",
          "export const total = count(2)",
          "once(1)",
          'if (total > 9) { fail("a"); fail("b") }',
          "",
        ].join("\n"),
      })
      expect(findings).toEqual([
        "src/lib.ts:2:14 ignored-returns returns number, which all 2 callers ignore: return nothing",
      ])
    }),
  )

  effect("duplicated-functions preserves whitespace inside strings, templates and regexes", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(
        duplicatedFunctions({ within: "src/**", minimumLength: 80 }),
        {
          "src/a.ts": [
            'export const message = (name: string): string => "Welcome  back, " + name.trim() + ". Your account is ready to use."',
            "export const template = (name: string): string => `Welcome  back, ${name.trim()}. Your account is ready to use.`",
            "export const pattern = (message: string): boolean => /Welcome  back, valued customer/.test(message.trim().toLowerCase())",
          ].join("\n"),
          "src/b.ts": [
            'export const message = (name: string): string => "Welcome back, " + name.trim() + ". Your account is ready to use."',
            "export const template = (name: string): string => `Welcome back, ${name.trim()}. Your account is ready to use.`",
            "export const pattern = (message: string): boolean => /Welcome back, valued customer/.test(message.trim().toLowerCase())",
          ].join("\n"),
        },
      )
      expect(findings).toEqual([])
    }),
  )

  effect("duplicated-functions reports copies across files, not short or same-file ones", () =>
    Effect.gen(function* () {
      const body =
        '(root: string, file: string): string => [root, file].map((part) => part.trim()).join("/")'
      const findings = yield* findingsOf(
        duplicatedFunctions({ within: "src/**", minimumLength: 40 }),
        {
          "src/a.ts": `export const join = ${body}\nexport const tiny = (n: number) => n\n`,
          "src/b.ts": `export const joinPaths = ${body}\nexport const tiny = (n: number) => n\n`,
          "src/c.ts": `export const different = (root: string, file: string): string => [file, root].map((part) => part.trim()).join("/")\n`,
        },
      )
      expect(findings).toEqual([
        "src/a.ts:1:14 duplicated-functions join is written out in 2 files (src/b.ts): keep one and import it",
        "src/b.ts:1:14 duplicated-functions joinPaths is written out in 2 files (src/a.ts): keep one and import it",
      ])
    }),
  )
})
