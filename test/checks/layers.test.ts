import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { layers } from "../../src/Checks/Layers.ts"
import { findingsOf } from "../utils/check.ts"

describe("layers", () => {
  effect("reports an import that points at a module listed below the importer", () =>
    Effect.gen(function* () {
      const findings = yield* findingsOf(
        layers({ within: "src/**", order: [["src/core.ts"], ["src/feature/"], ["src/app.ts"]] }),
        {
          "src/core.ts": [
            'import type { Feature } from "./feature/index.js"',
            "export const core = (feature: Feature) => feature",
            "",
          ].join("\n"),
          "src/feature/index.ts": [
            'import { core } from "../core.js"',
            'import { helper } from "./helper.js"',
            "export interface Feature { readonly name: string }",
            "export const feature = core({ name: helper })",
            "",
          ].join("\n"),
          "src/feature/helper.ts": 'export const helper = "helper"\n',
          "src/app.ts":
            'import { feature } from "./feature/index.js"\nexport const app = feature\n',
          "src/unlisted.ts": 'import { app } from "./app.js"\nexport const unlisted = app\n',
        },
      )
      expect(findings).toEqual([
        "src/core.ts:1:1 layers imports src/feature/index.ts, which is listed below it",
      ])
    }),
  )
})
