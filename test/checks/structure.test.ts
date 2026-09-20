import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import {
  anyInPublicApi,
  importCycles,
  oversized,
  suppressions,
  unjustifiedCasts,
  unusedCode,
} from "../../src/Checks/index.ts"
import { findingsOf } from "../utils/check.ts"

describe("structure rules", () => {
  effect(
    "import-cycles follows a cycle through any number of files, with or without type imports",
    () =>
      Effect.gen(function* () {
        const files = {
          "src/a.ts": 'import { b } from "./b.js"\nexport const a = 1 + b\n',
          "src/b.ts": 'import { c } from "./c.js"\nexport const b = c\n',
          "src/c.ts": 'import type { A } from "./types.js"\nexport const c: A = 1\n',
          "src/types.ts": 'import type { a } from "./a.js"\nexport type A = typeof a\n',
          "src/leaf.ts": 'import { a } from "./a.js"\nexport const leaf = a\n',
        }
        expect(
          yield* findingsOf(importCycles({ within: "src/**", typeImports: false }), files),
        ).toEqual([])
        const findings = yield* findingsOf(
          importCycles({ within: "src/**", typeImports: true }),
          files,
        )
        expect(findings.map((finding) => finding.split(" import-cycles ")[0])).toEqual([
          "src/a.ts:1:1",
          "src/b.ts:1:1",
          "src/c.ts:1:1",
          "src/types.ts:1:1",
        ])
      }),
  )

  effect(
    "oversized reports a long function, a wide one and a long file, and nothing at the limit",
    () =>
      Effect.gen(function* () {
        const body = Array.from({ length: 6 }, (_, index) => `  const v${index} = ${index}`).join(
          "\n",
        )
        const findings = yield* findingsOf(
          oversized({ within: "src/**", functionLines: 7, parameters: 2, fileLines: 12 }),
          {
            "src/big.ts": `export const long = () => {\n${body}\n  return 0\n}\nexport const wide = (a: number, b: number, c: number) => a + b + c\nexport const fine = (a: number, b: number) => a + b\n\n`,
            "src/small.ts": `export const atLimit = () => {\n${body.split("\n").slice(0, 5).join("\n")}\n}\n`,
          },
        )
        expect(findings).toEqual([
          "src/big.ts:1:1 oversized 13 lines, over the limit of 12: split it by responsibility",
          "src/big.ts:1:14 oversized long is 9 lines, over the limit of 7: extract named steps",
          "src/big.ts:10:14 oversized wide takes 3 parameters, over the limit of 2: pass one options object",
        ])
      }),
  )

  effect("any-in-public-api reaches exports published through a namespace re-export only", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(anyInPublicApi({ publicApi: ["src/index.ts"] }), {
        "src/index.ts": 'export * as Shapes from "./shapes.js"\n',
        "src/shapes.ts": [
          "export const loose = (input: Array<any>): number => input.length",
          "export const strict = (input: Array<string>): number => input.length",
          "",
        ].join("\n"),
        "src/internal.ts": "export const hidden = (input: any): number => input\n",
      })
      expect(findings).toEqual([
        "src/shapes.ts:1:14 any-in-public-api loose is public and its type contains any: callers lose checking through it",
      ])
    }),
  )

  effect("unused-code treats a namespace re-export as publishing every member", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(
        unusedCode({ within: "src/**", tests: "test/**", publicApi: ["src/index.ts"] }),
        {
          "src/index.ts": 'export * as Shapes from "./shapes.js"\n',
          "src/shapes.ts": "export const published = 1\n",
          "src/internal.ts": "export const orphan = 1\n",
        },
      )
      expect(findings).toEqual(["src/internal.ts:1:14 unused-code orphan is never used: delete it"])
    }),
  )

  effect("suppressions reports directives and non-null assertions, not the word in a string", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(suppressions({ within: "src/**" }), {
        "src/s.ts": [
          "const list: Array<number> = []",
          "// @ts-expect-error planted",
          "export const wrong: string = 1",
          "export const first = list[0]!",
          "export const safe = list[0] ?? 0",
          "",
        ].join("\n"),
      })
      expect(findings).toEqual([
        "src/s.ts:2:4 suppressions @ts-expect-error silences the compiler: fix the type it complains about",
        "src/s.ts:4:22 suppressions list[0]! asserts non-null on trust: handle the undefined case",
      ])
    }),
  )

  effect("unjustified-casts reports erasing a known type to any", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(unjustifiedCasts({ within: "src/**" }), {
        "src/c.ts":
          "declare const n: number\ndeclare const u: unknown\nexport const a = n as any\nexport const b = u as any\n",
      })
      expect(findings).toEqual([
        "src/c.ts:3:18 unjustified-casts erases number to any: keep the type, or fix the signature that rejects it",
      ])
    }),
  )
})
