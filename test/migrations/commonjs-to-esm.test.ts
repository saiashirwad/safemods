import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { commonJsToEsm } from "../../examples/commonjs-to-esm.ts"
import * as Recipe from "../../src/Recipe.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { fixturePath, withFixture } from "../utils/fixture.ts"

describe("commonjs-to-esm", () => {
  effect("converts safe top-level forms and reports ambiguous ones", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          const input = { project: app }
          const { plan, verified } = yield* executeRecipe(commonJsToEsm, input)

          expect(plan.edits).toHaveLength(8)
          expect(verified.diagnosticDiff.introduced).toHaveLength(0)

          const original = yield* Effect.tryPromise(() =>
            Fs.readFile(
              Path.join(fixturePath("migrations/commonjs-to-esm"), "src/unsupported.js"),
              "utf8",
            ),
          )
          expect(plan.unsupported.map(({ start, end }) => original.slice(start, end))).toEqual([
            'const conditional = process.env.FEATURE && require("feature")',
            "exports[computedName] = conditional",
          ])

          const index = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/index.js"), "utf8"),
          )
          expect(index).toContain('import * as path from "node:path"')
          expect(index).toContain('import { readFile, writeFile as saveFile } from "node:fs"')
          expect(index).toContain('import { inspect } from "node:util"')
          expect(index).toContain('import "./register.js"')
          expect(index).toContain("export const readFile = readFile")
          expect(index).toContain("export const inspect = inspect")
          expect(index).toContain("export default { path, saveFile }")

          const unsupported = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/unsupported.js"), "utf8"),
          )
          expect(unsupported).toContain('return require("not-a-module-reference")')
          expect(unsupported).toContain('require("feature")')

          const shadowed = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/shadowed.js"), "utf8"),
          )
          expect(shadowed).toContain('const loaded = require("node:path")')
          expect(shadowed).toContain("export default { loaded }")

          const second = yield* Recipe.run(commonJsToEsm, input)
          expect(second.edits).toHaveLength(0)
          expect(second.unsupported).toHaveLength(2)
        }),
      { fixture: "migrations/commonjs-to-esm" },
    ),
  )
})
