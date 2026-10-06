import { execFile } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Check from "../src/Check.ts"
import * as Query from "../src/Query.ts"
import { findingsOf } from "./utils/check.ts"
import { workspacePath } from "./utils/domain.ts"
import { withFixture } from "./utils/fixture.ts"

const flagged = (name: string) =>
  Check.define(
    `flagged:${name}`,
    (snapshot) =>
      Effect.gen(function* () {
        const found = yield* Query.identifiers(snapshot.projects[0]!).pipe(
          Query.filter(({ value }) => value.text === name),
        )
        return found.map((selection) => Check.report(selection, `${name} is flagged`))
      }),
  )

const repoFile = (relative: string): string =>
  fileURLToPath(new URL(`../${relative}`, import.meta.url))

const safemods = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.promise(
    () =>
      new Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>(
        (resolve) =>
          execFile(
            process.execPath,
            ["--conditions=source", repoFile("src/bin.ts"), "check", ...args],
            { cwd },
            (error, stdout, stderr) =>
              resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr }),
          ),
      ),
  )

describe("checks", () => {
  effect("keeps distinct findings even when their text output is identical", () =>
    withFixture(
      () =>
        Effect.gen(function* () {
          const at = workspacePath("src/lib.ts")
          const results = yield* Check.run([
            Check.define("a b", () => Effect.succeed([Check.reportAt(at, "c")])),
            Check.define(
              "a",
              () =>
                Effect.succeed([
                  Check.reportAt(at, "b c"),
                  { fileName: at, start: 0, end: 1, message: "b c" },
                ]),
            ),
          ])
          expect(results.map(({ check, message, end }) => [check, message, end])).toEqual([
            ["a", "b c", 0],
            ["a", "b c", 1],
            ["a b", "c", 0],
          ])
          expect(results.map(Check.format)).toEqual([
            "src/lib.ts:1:1 a b c",
            "src/lib.ts:1:1 a b c",
            "src/lib.ts:1:1 a b c",
          ])
        }),
      {
        fixture: "empty",
        files: {
          "tsconfig.json": JSON.stringify({ include: ["src/**/*.ts"] }),
          "src/lib.ts": "export const value = 1\n",
        },
      },
    ))

  effect(
    "locates findings by workspace path with one-based lines and columns, in order",
    () =>
      Effect.gen(function* () {
        const findings = yield* findingsOf(flagged("beta"), {
          "src/zeta.ts": "export const beta = 1\n",
          "src/alpha.ts": "export const alpha = 1\n\n  export const beta = alpha\n",
        })
        expect(findings).toEqual([
          "src/alpha.ts:3:16 flagged:beta beta is flagged",
          "src/zeta.ts:1:14 flagged:beta beta is flagged",
        ])
      }),
  )

  effect(
    "the binary exits 1 on findings and 2 on a config it cannot load",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const run = (...args: ReadonlyArray<string>) => safemods(root, args)

            const first = yield* run("--format", "json")
            expect(first.code).toBe(1)
            expect(JSON.parse(first.stdout)).toEqual([
              {
                check: "layers",
                fileName: "src/core.ts",
                start: 0,
                end: 30,
                line: 1,
                column: 1,
                message: "imports src/app.ts, which is listed below it",
              },
            ])

            const broken = yield* run("--config", "missing.config.ts")
            expect(broken.code).toBe(2)
          }),
        {
          fixture: "empty",
          files: {
            "tsconfig.json": JSON.stringify({
              compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", noEmit: true },
              include: ["src/**/*.ts"],
            }),
            "src/core.ts": 'import { app } from "./app.js"\nexport const core = app\n',
            "src/app.ts": "export const app = 1\n",
            "safemods.config.ts": [
              `import { layers } from ${
                JSON.stringify(pathToFileURL(repoFile("src/Checks/Layers.ts")).href)
              }`,
              "export default {",
              '  projects: [{ id: "app", config: "tsconfig.json" }],',
              '  checks: [layers({ within: "src/**", order: [["src/core.ts", "src/extra.ts"], ["src/app.ts"]] })],',
              "}",
              "",
            ].join("\n"),
          },
        },
      ),
    { timeout: 30_000 },
  )
})
