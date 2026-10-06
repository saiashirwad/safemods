import { spawnSync } from "node:child_process"
import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { commonJsToEsm } from "../../examples/commonjs-to-esm.ts"
import { applyFileEdits } from "../../src/Edit.ts"
import { proposalOf, executeRecipe } from "../utils/execute-recipe.ts"
import { fixturePath, withFixture, read } from "../utils/fixture.ts"

describe("commonjs-to-esm", () => {
  effect(
    "preserves expression exports that collide with mutable, function, or import bindings",
    () => {
      const source = [
        'import { readFile as imported } from "node:fs"',
        "let total = 0",
        "function calculate() { return 0 }",
        "exports.total = 1 + 2",
        "exports.calculate = () => 1",
        "exports.imported = 3",
        "exports.fresh = 4",
        "exports.fresh = 5",
        "",
      ].join("\n")
      return withFixture((root, project) =>
        Effect.gen(function* () {
          const proposal = yield* proposalOf(commonJsToEsm, { project })
          const actual = yield* applyFileEdits(source, proposal.edits)
          const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], {
            input: actual,
            encoding: "utf8",
          })
          expect(syntax.stderr).toBe("")
          expect(syntax.status).toBe(0)
          expect(actual).toBe(source.replace("exports.fresh = 4", "export const fresh = 4"))
          const { verified } = yield* executeRecipe(commonJsToEsm, { project })
          expect(yield* read(root, "src/collisions.js")).toBe(actual)
          expect(verified.unsupported.map(({ start, end }) => source.slice(start, end))).toEqual([
            "exports.total = 1 + 2",
            "exports.calculate = () => 1",
            "exports.imported = 3",
            "exports.fresh = 5",
          ])
          expect((yield* proposalOf(commonJsToEsm, { project })).edits).toHaveLength(0)
        }), {
        fixture: "empty",
        files: {
          "src/collisions.js": source,
          "package.json": '{"type":"module"}',
          "tsconfig.json": JSON.stringify({
            compilerOptions: { allowJs: true, checkJs: false, noEmit: true, module: "NodeNext" },
            include: ["src/**/*.js"],
          }),
        },
      })
    },
  )

  effect("converts project ambient global require but preserves lexical shadows", () =>
    withFixture(
      (root, project) =>
        Effect.gen(function* () {
          const { verified } = yield* executeRecipe(commonJsToEsm, { project })
          expect(verified.unsupported.some(({ fileName }) => fileName === "src/namespace.ts")).toBe(
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
    ))

  effect("converts safe top-level forms and reports ambiguous ones", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          const input = { project: app }
          const { verified } = yield* executeRecipe(commonJsToEsm, input)

          expect(verified.diagnosticDiff.introduced).toHaveLength(0)

          const original = yield* Effect.tryPromise(() =>
            Fs.readFile(
              Path.join(fixturePath("migrations/commonjs-to-esm"), "src/unsupported.js"),
              "utf8",
            )
          )
          expect(verified.unsupported.map(({ start, end }) => original.slice(start, end))).toEqual([
            'const conditional = process.env.FEATURE && require("feature")',
            "exports[computedName] = conditional",
            "exports.current = current",
            "exports.missing = missing",
            "exports.occupied = 1 + 2",
          ])

          const index = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/index.js"), "utf8")
          )
          const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], {
            input: index,
            encoding: "utf8",
          })
          expect(syntax.stderr).toBe("")
          expect(syntax.status).toBe(0)
          expect(index).toContain('import * as path from "node:path"')
          expect(index).toContain('import { readFile, writeFile as saveFile } from "node:fs"')
          expect(index).toContain('import { inspect } from "node:util"')
          expect(index).toContain('import "./register.js"')
          expect(index).toContain("export { readFile }")
          expect(index).toContain("export { inspect }")
          expect(index).toContain("export { readFile as read }")
          expect(index).toContain("export { answer }")
          expect(index).toContain("export const total = 1 + 2")
          expect(index).toContain("export default { path, saveFile }")

          const unsupported = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/unsupported.js"), "utf8")
          )
          expect(unsupported).toContain('return require("not-a-module-reference")')
          expect(unsupported).toContain('require("feature")')

          const shadowed = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/shadowed.js"), "utf8")
          )
          expect(shadowed).toContain('const loaded = require("node:path")')
          expect(shadowed).toContain("export default { loaded }")

          const second = yield* proposalOf(commonJsToEsm, input)
          expect(second.edits).toHaveLength(0)
          expect(second.unsupported).toHaveLength(5)
        }),
      { fixture: "migrations/commonjs-to-esm" },
    ))
})
