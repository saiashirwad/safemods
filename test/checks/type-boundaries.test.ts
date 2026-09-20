import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { typeBoundaries } from "../../src/Checks/TypeBoundaries.ts"
import { findingsOf } from "../utils/check.ts"

describe("type-boundaries", () => {
  effect(
    "reports named, star and import-then-export leaks at the publishing file",
    () =>
      Effect.gen(function* () {
        const findings = yield* findingsOf(
          typeBoundaries({ within: "src/api-*.ts", forbidden: { files: ["src/secrets.ts"] } }),
          {
            "src/secrets.ts": "export interface Secret { readonly token: string }\n",
            "src/service.ts":
              'import type { Secret } from "./secrets.js"\nexport declare const load: () => Secret\nexport const safe = 1\n',
            "src/api-named.ts": 'export { load as renamed, safe } from "./service.js"\n',
            "src/api-star.ts": 'export * from "./service.js"\n',
            "src/api-import.ts":
              'import { load, safe } from "./service.js"\nexport { load, safe }\n',
            "src/api-type.ts": 'export type { Secret } from "./secrets.js"\n',
          },
        )
        expect(findings).toEqual([
          "src/api-import.ts:1:1 type-boundaries exports load with a type mentioning Secret, declared in src/secrets.ts",
          "src/api-named.ts:1:1 type-boundaries exports renamed with a type mentioning Secret, declared in src/secrets.ts",
          "src/api-star.ts:1:1 type-boundaries exports load with a type mentioning Secret, declared in src/secrets.ts",
          "src/api-type.ts:1:1 type-boundaries exports Secret with a type mentioning Secret, declared in src/secrets.ts",
        ])
      }),
  )

  effect(
    "reports a leak inferred through another module, but not a lookalike or a local use",
    () =>
      Effect.gen(function* () {
        const findings = yield* findingsOf(
          typeBoundaries({ within: "src/api.ts", forbidden: { files: ["src/secrets.ts"] } }),
          {
            "src/secrets.ts": [
              "export interface Secret { readonly token: string }",
              "export type Token = { readonly value: string }",
              "",
            ].join("\n"),
            "src/allowed.ts": "export interface Secret { readonly token: string }\n",
            "src/service.ts": [
              'import type { Secret } from "./secrets.js"',
              'export const load = (): Secret => ({ token: "t" })',
              "",
            ].join("\n"),
            "src/api.ts": [
              'import { load } from "./service.js"',
              'import type { Secret as Allowed } from "./allowed.js"',
              'import type { Token } from "./secrets.js"',
              "export declare const aliased: Token",
              "export const account = () => load()",
              "export const many = () => [load()]",
              "export type Loader = typeof load",
              'export const allowed = (): Allowed => ({ token: "t" })',
              "export const count = () => {",
              "  const held = load()",
              "  return held.token.length",
              "}",
              "",
            ].join("\n"),
          },
        )
        expect(findings).toEqual([
          "src/api.ts:4:22 type-boundaries exports aliased with a type mentioning Token, declared in src/secrets.ts",
          "src/api.ts:5:14 type-boundaries exports account with a type mentioning Secret, declared in src/secrets.ts",
          "src/api.ts:6:14 type-boundaries exports many with a type mentioning Secret, declared in src/secrets.ts",
          "src/api.ts:7:1 type-boundaries exports Loader with a type mentioning Secret, declared in src/secrets.ts",
        ])
      }),
  )

  effect(
    "reports a type from a forbidden package, but not a lookalike or a library type",
    () =>
      Effect.gen(function* () {
        const findings = yield* findingsOf(
          typeBoundaries({ within: "src/compiler.ts", forbidden: { packages: ["typescript"] } }),
          {
            "src/local.ts": "export interface SourceFile { readonly fileName: string }\n",
            "src/compiler.ts": [
              'import type { SourceFile } from "typescript/unstable/ast"',
              'import type { SourceFile as Local } from "./local.js"',
              "export const nameOf = (file: SourceFile) => file.fileName",
              "export const localName = (file: Local) => file.fileName",
              "export const lengths = (texts: ReadonlyArray<string>) => texts.map((text) => text.length)",
              "",
            ].join("\n"),
          },
          { dependencies: true },
        )
        expect(findings).toEqual([
          "src/compiler.ts:3:14 type-boundaries exports nameOf with a type mentioning SourceFile, declared in node_modules/typescript/dist/ast/ast.d.ts",
        ])
      }),
  )
})
