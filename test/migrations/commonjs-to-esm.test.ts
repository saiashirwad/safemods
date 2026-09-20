import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { commonJsToEsm } from "../../examples/commonjs-to-esm.ts"
import * as Recipe from "../../src/Recipe.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { fixturePath, withFixture, read } from "../utils/fixture.ts"

describe("commonjs-to-esm", () => {
  effect("converts project ambient global require but preserves lexical shadows", () =>
    withFixture(
      (root, project) =>
        Effect.gen(function* () {
          const { plan, verified } = yield* executeRecipe(commonJsToEsm, { project })
          expect(plan.unsupported.some(({ fileName }) => fileName === "src/namespace.ts")).toBe(
            false,
          )
          expect(yield* read(root, "src/namespace.ts")).toContain('require("local")')
          expect(verified.diagnosticDiff.introduced).toHaveLength(0)
          expect(yield* read(root, "src/ambient.ts")).toContain('import "./register.js"')
          expect(yield* read(root, "src/local.ts")).toContain('require("./register.js")')
          expect(yield* read(root, "src/shadowed.js")).toContain(
            'const loaded = require("node:path")',
          )
        }),
      {
        fixture: "migrations/commonjs-to-esm",
        files: {
          "tsconfig.json": JSON.stringify({
            compilerOptions: {
              allowJs: true,
              module: "NodeNext",
              moduleResolution: "NodeNext",
              noEmit: true,
            },
            include: ["src/**/*"],
          }),
          "src/globals.d.ts": "declare function require(id: string): unknown\n",
          "src/augmentation.d.ts":
            "export {}\ndeclare global { function require(id: string): unknown }\n",
          "src/namespace.ts": [
            "export namespace global {",
            "  export function require(id: string): string { return id }",
            '  export const loaded = require("local")',
            "}",
            "",
          ].join("\n"),
          "src/ambient.ts": 'require("./register.js")\nexport {}\n',
          "src/local.ts":
            'declare function require(id: string): unknown\nrequire("./register.js")\nexport {}\n',
        },
      },
    ),
  )

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
