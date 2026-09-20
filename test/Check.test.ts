import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Check from "../src/Check.ts"
import * as Query from "../src/Query.ts"
import { WorkspaceSnapshot } from "../src/Workspace/index.ts"
import { findingsOf } from "./utils/check.ts"
import { withFixture } from "./utils/fixture.ts"

const flagged = (name: string) =>
  Check.define(
    `flagged:${name}`,
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const found = yield* Query.identifiers(snapshot.projects[0]!).pipe(
        Query.filter(({ value }) => value.text === name),
        Query.collect,
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
  effect("locates findings by workspace path with one-based lines and columns, in order", () =>
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
                path: "src/core.ts",
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
              `import { layers } from ${JSON.stringify(repoFile("src/Checks/Layers.ts"))}`,
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
