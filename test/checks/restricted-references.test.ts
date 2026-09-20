import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { restrictedReferences } from "../../src/Checks/RestrictedReferences.ts"
import { projectPath } from "../utils/domain.ts"
import { findingsOf } from "../utils/check.ts"

describe("restricted-references", () => {
  effect(
    "reports a use once when the name is declared by an interface and its implementation",
    () =>
      Effect.gen(function* () {
        const findings = yield* findingsOf(
          restrictedReferences({
            name: "unsafe",
            declaredIn: projectPath("src/internal/service.ts"),
            allowedWithin: ["src/internal/**"],
          }),
          {
            "src/internal/service.ts": [
              "export interface Service { readonly unsafe: () => number }",
              "export const service: Service = { unsafe: () => 1 }",
              "",
            ].join("\n"),
            "src/feature.ts": [
              'import { service } from "./internal/service.js"',
              "export const leaked = service.unsafe()",
              "",
            ].join("\n"),
          },
        )
        expect(findings).toEqual([
          "src/feature.ts:2:31 restricted-references:unsafe unsafe may only be used within src/internal/**",
        ])
      }),
  )

  effect("follows aliases and re-exports to uses outside the allowed files", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(
        restrictedReferences({
          name: "escapeHatch",
          declaredIn: projectPath("src/internal/hatch.ts"),
          allowedWithin: ["src/internal/**"],
        }),
        {
          "src/internal/hatch.ts": "export const escapeHatch = (): number => 1\n",
          "src/internal/index.ts": 'export { escapeHatch as hatch } from "./hatch.js"\n',
          "src/internal/user.ts":
            'import { escapeHatch } from "./hatch.js"\nexport const ok = escapeHatch()\n',
          "src/feature.ts": [
            'import { hatch as renamed } from "./internal/index.js"',
            "export const leaked = renamed()",
            "const escapeHatch = (): number => 2",
            "export const unrelated = escapeHatch()",
            "",
          ].join("\n"),
        },
      )
      expect(findings).toEqual([
        "src/feature.ts:1:10 restricted-references:escapeHatch escapeHatch may only be used within src/internal/**",
        "src/feature.ts:1:19 restricted-references:escapeHatch escapeHatch may only be used within src/internal/**",
        "src/feature.ts:2:23 restricted-references:escapeHatch escapeHatch may only be used within src/internal/**",
      ])
    }),
  )
})
