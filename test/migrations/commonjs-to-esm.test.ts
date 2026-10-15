import { spawnSync } from "node:child_process"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { commonJsToEsm, type CommonJsToEsmInput } from "../../examples/commonjs-to-esm.ts"
import { expectMigration } from "../utils/expect-migration.ts"
import { fixturePath, read } from "../utils/fixture.ts"

const inputFor = (project: CommonJsToEsmInput["project"]): CommonJsToEsmInput => ({ project })

const readFixture = (fixture: string, fileName: string) => read(fixturePath(fixture), fileName)

const parsesAsModule = (source: string) => {
  const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: source,
    encoding: "utf8",
  })
  expect(syntax.stderr).toBe("")
  expect(syntax.status).toBe(0)
}

describe("commonjs-to-esm", () => {
  effect(
    "preserves expression exports that collide with mutable, function, or import bindings",
    () =>
      Effect.gen(function* () {
        const fixture = "migration-cases/commonjs-to-esm-collisions"
        const { verified } = yield* expectMigration(commonJsToEsm, fixture, inputFor)
        const source = yield* readFixture(fixture, "src/collisions.js")
        parsesAsModule(yield* readFixture(fixture, "expected/src/collisions.js"))
        expect(verified.unsupported.map(({ start, end }) => source.slice(start, end))).toEqual([
          "exports.total = 1 + 2",
          "exports.calculate = () => 1",
          "exports.imported = 3",
          "exports.fresh = 5",
        ])
      }),
  )

  effect(
    "converts project ambient global require but preserves lexical shadows",
    () =>
      Effect.gen(function* () {
        const { verified } = yield* expectMigration(
          commonJsToEsm,
          "migration-cases/commonjs-to-esm-ambient-require",
          inputFor,
        )
        expect(verified.unsupported.some(({ fileName }) => fileName === "src/namespace.ts")).toBe(
          false,
        )
        expect(verified.diagnosticDiff.introduced).toHaveLength(0)
      }),
  )

  effect("converts safe top-level forms and reports ambiguous ones", () =>
    Effect.gen(function* () {
      const fixture = "migrations/commonjs-to-esm"
      const { verified, rerun } = yield* expectMigration(commonJsToEsm, fixture, inputFor)
      expect(verified.diagnosticDiff.introduced).toHaveLength(0)

      const original = yield* readFixture(fixture, "src/unsupported.js")
      expect(verified.unsupported.map(({ start, end }) => original.slice(start, end))).toEqual([
        'const conditional = process.env.FEATURE && require("feature")',
        "exports[computedName] = conditional",
        "exports.current = current",
        "exports.missing = missing",
        "exports.occupied = 1 + 2",
      ])
      parsesAsModule(yield* readFixture(fixture, "expected/src/index.js"))
      expect(rerun.unsupported).toHaveLength(5)
    }))
})
