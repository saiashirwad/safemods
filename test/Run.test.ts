import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { read, withFixture } from "./utils/fixture.ts"

const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const recipe = fileURLToPath(new URL("../examples/rename-symbol.ts", import.meta.url))

const run = (cwd: string, to: string, ...flags: ReadonlyArray<string>) =>
  Effect.promise(
    () =>
      new Promise<{ readonly code: number; readonly lines: ReadonlyArray<string> }>((resolve) =>
        execFile(
          process.execPath,
          [
            "--conditions=source",
            bin,
            "run",
            recipe,
            "--input",
            JSON.stringify({ file: "src/lib.ts", name: "area", to }),
            ...flags,
          ],
          { cwd },
          (error, stdout) =>
            resolve({
              code: typeof error?.code === "number" ? error.code : 0,
              lines: stdout.trimEnd().split("\n").slice(1),
            }),
        )
      ),
  )

const lib = [
  "/** Use {@link area}. Example: area(2) */",
  "export const area = (n: number): number => n * n",
  "export const size = (n: number): number => n",
  "",
].join("\n")
const other = 'export const area = "unrelated"\n'
const user = [
  'import { area as measure } from "./lib.js"',
  'import { area } from "./other.js"',
  "export const total = measure(2) + area.length",
  "",
].join("\n")

const files = {
  "packages/app/tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
    },
    include: ["src/**/*.ts"],
  }),
  "safemods.config.ts":
    'export default { projects: [{ id: "app", config: "packages/app/tsconfig.json" }], checks: [] }\n',
  "packages/app/src/lib.ts": lib,
  "packages/app/src/other.ts": other,
  "packages/app/src/user.ts": user,
}

const sources = (root: string) =>
  Effect.all(["lib", "other", "user"].map((name) => read(root, `packages/app/src/${name}.ts`)))

describe("safemods run", () => {
  effect(
    "previews without writing, then writes exactly the verified plan for a project below the workspace root",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const preview = yield* run(root, "squared")
            expect(preview).toEqual({
              code: 0,
              lines: [
                "  modify src/lib.ts",
                "  modify src/user.ts",
                "left for you (1):",
                "  src/lib.ts:1:32 mentions area in a comment or string the compiler cannot resolve",
                "verified: 0 new diagnostic(s), 0 resolved",
                "not written: pass --apply",
              ],
            })
            expect(yield* sources(root)).toEqual([lib, other, user])

            const applied = yield* run(root, "squared", "--apply")
            expect(applied.lines.at(-1)).toBe("applied to 2 file(s)")
            expect(yield* sources(root)).toEqual([
              lib.replace("{@link area}", "{@link squared}").replace("const area", "const squared"),
              other,
              user.replace("area as measure", "squared as measure"),
            ])
          }),
        { fixture: "empty", files },
      ),
    { timeout: 60_000 },
  )

  effect(
    "rejects a rename onto a taken name with located compiler errors and writes nothing",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            expect(yield* run(root, "size", "--apply")).toEqual({
              code: 1,
              lines: [
                "rejected (diagnostics): Introduced 2 new error diagnostic(s)",
                "  packages/app/src/lib.ts:2:14 TS2451 Cannot redeclare block-scoped variable 'size'.",
                "  packages/app/src/lib.ts:3:14 TS2451 Cannot redeclare block-scoped variable 'size'.",
                "nothing was written",
              ],
            })
            expect(yield* sources(root)).toEqual([lib, other, user])
          }),
        { fixture: "empty", files },
      ),
    { timeout: 60_000 },
  )
})
