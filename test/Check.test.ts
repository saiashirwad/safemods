import { execFile } from "node:child_process"
import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Check from "../src/Check.ts"
import { Comparison } from "../src/Comparison.ts"
import * as Query from "../src/Query.ts"
import { WorkspaceSnapshot } from "../src/Workspace/index.ts"
import { findingsOf } from "./utils/check.ts"
import { withFixture, write } from "./utils/fixture.ts"

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

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve, reject) =>
        execFile(
          "git",
          [...args],
          {
            cwd,
            env: {
              ...process.env,
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_CONFIG_SYSTEM: "/dev/null",
            },
          },
          (error) => (error === null ? resolve() : reject(error)),
        ),
      ),
  )

const commitAll = (root: string) =>
  Effect.gen(function* () {
    yield* git(root, ["init", "--quiet"])
    yield* git(root, ["config", "user.name", "safemods"])
    yield* git(root, ["config", "user.email", "safemods@example.test"])
    yield* git(root, ["add", "-A"])
    yield* git(root, ["commit", "--quiet", "-m", "base"])
  })

const remove = (root: string, fileName: string) =>
  Effect.promise(() => Fs.rm(Path.join(root, fileName)))

const move = (root: string, from: string, to: string) =>
  Effect.promise(() => Fs.rename(Path.join(root, from), Path.join(root, to)))

const weak = (name: string) => `export const ${name} = (text: string) => JSON.parse(text)\n`

const sinceFixture = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", noEmit: true },
    include: ["src/**/*.ts"],
  }),
  "safemods.config.ts": [
    `import { weakReturns } from ${JSON.stringify(repoFile("src/Checks/WeakReturns.ts"))}`,
    "export default {",
    '  projects: [{ id: "app", config: "tsconfig.json" }],',
    '  checks: [weakReturns({ within: "src/**" })],',
    "}",
    "",
  ].join("\n"),
  "src/old.ts": weak("old"),
  "src/tracked.ts": "export const tracked = (text: string) => text\n",
  "src/lib.ts": `export const value: any = 1\n${weak("weak")}`,
  "src/reads.ts": 'import { value } from "./lib.js"\nexport const read = () => value\n',
}

const comparisonFixture = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", noEmit: true },
    include: ["src/**/*.ts"],
  }),
  "safemods.config.ts": [
    `import { weakReturns } from ${JSON.stringify(repoFile("src/Checks/WeakReturns.ts"))}`,
    `import { apiCompatibility } from ${JSON.stringify(repoFile("src/Checks/ApiCompatibility.ts"))}`,
    "export default {",
    '  projects: [{ id: "app", config: "tsconfig.json" }],',
    '  checks: [weakReturns({ within: "src/**" })],',
    '  comparisons: [apiCompatibility({ within: "src/**" })],',
    "}",
    "",
  ].join("\n"),
  "src/api.ts": `export const send = (label: string): void => {}\n${weak("parse")}`,
}

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

  effect("a config refuses a comparison listed among the ordinary checks", () =>
    Effect.sync(() => {
      const comparison = Check.define(
        "needs-both-versions",
        Effect.gen(function* () {
          yield* Comparison
          return []
        }),
      )
      const config: Check.Config = {
        projects: [],
        // @ts-expect-error a check that reads Comparison belongs in `comparisons`
        checks: [comparison],
        comparisons: [comparison],
      }
      expect(config.comparisons).toEqual([comparison])
    }),
  )

  effect("introducedSince forgives each known finding once, wherever it has moved", () =>
    Effect.sync(() => {
      const finding = (line: number, message = "beta is flagged"): Check.Finding => ({
        check: "flagged:beta",
        path: "src/alpha.ts",
        line,
        column: 1,
        message,
      })
      const known = [{ check: "flagged:beta", path: "src/alpha.ts", message: "beta is flagged" }]
      expect(Check.introducedSince(known, [finding(40)])).toEqual([])
      expect(Check.introducedSince(known, [finding(3), finding(9)])).toEqual([finding(9)])
      expect(Check.introducedSince(known, [finding(3, "other")])).toEqual([finding(3, "other")])
    }),
  )

  effect(
    "the binary exits 1 on findings, accepts a baseline, and then fails only on new ones",
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

            const recorded = yield* run("--baseline", "known.json", "--update-baseline")
            expect(recorded.code).toBe(0)
            const accepted = yield* run("--baseline", "known.json")
            expect(accepted).toMatchObject({ code: 0, stdout: "\n" })
            expect(accepted.stderr).toContain("0 finding(s), 1 known")

            yield* Effect.promise(() =>
              Fs.writeFile(
                Path.join(root, "src/extra.ts"),
                'import { app } from "./app.js"\nexport const extra = app\n',
              ),
            )
            const regressed = yield* run("--baseline", "known.json")
            expect(regressed.code).toBe(1)
            expect(regressed.stdout).toBe(
              "src/extra.ts:1:1 layers imports src/app.ts, which is listed below it\n",
            )

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

  effect(
    "--since forgives what the ref already had and reports what the working tree added",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const run = () => safemods(root, ["--since", "HEAD"])
            yield* commitAll(root)

            yield* write(root, "src/tracked.ts", weak("tracked"))
            const edited = yield* run()
            expect(edited.stdout).toBe("src/tracked.ts:1:24 weak-returns returns any\n")
            expect(edited.code).toBe(1)

            yield* write(root, "src/tracked.ts", "export const tracked = (text: string) => text\n")
            const unchanged = yield* run()
            expect(unchanged).toMatchObject({ code: 0, stdout: "\n" })
            expect(unchanged.stderr).toContain("0 finding(s), 3 known")

            yield* write(root, "src/added.ts", weak("added"))
            const untracked = yield* run()
            expect(untracked.stdout).toBe("src/added.ts:1:22 weak-returns returns any\n")
            expect(untracked.code).toBe(1)

            yield* remove(root, "src/added.ts")
            const cleared = yield* run()
            expect(cleared).toMatchObject({ code: 0, stdout: "\n" })
          }),
        { fixture: "empty", files: sinceFixture },
      ),
    { timeout: 60_000 },
  )

  effect(
    "--since keeps a finding known when its file moves, and still reports its lookalike",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            yield* commitAll(root)
            yield* move(root, "src/lib.ts", "src/moved.ts")
            yield* write(
              root,
              "src/reads.ts",
              'import { value } from "./moved.js"\nexport const read = () => value\n',
            )

            const moved = yield* safemods(root, ["--since", "HEAD"])
            expect(moved.stdout).toBe("src/moved.ts:2:21 weak-returns returns any\n")
            expect(moved.stderr).toContain("1 finding(s), 2 known")
            expect(moved.code).toBe(1)
          }),
        { fixture: "empty", files: sinceFixture },
      ),
    { timeout: 60_000 },
  )

  effect(
    "a comparison check is skipped and named without --since, and reports the change with it",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            yield* commitAll(root)
            yield* write(
              root,
              "src/api.ts",
              `export const send = (label: number): void => {}\n${weak("parse")}`,
            )

            const skipped = yield* safemods(root, [])
            expect(skipped.stdout).toBe("src/api.ts:2:22 weak-returns returns any\n")
            expect(skipped.stderr).toContain("skipped without --since: api-compatibility")
            expect(skipped.code).toBe(1)

            const compared = yield* safemods(root, ["--since", "HEAD"])
            expect(compared.stdout).toBe(
              "src/api.ts:1:14 api-compatibility breaking change to export send: was (label: string) => void, now (label: number) => void\n",
            )
            expect(compared.stderr).not.toContain("skipped")
            expect(compared.stderr).toContain("1 finding(s), 1 known")
            expect(compared.code).toBe(1)
          }),
        { fixture: "empty", files: comparisonFixture },
      ),
    { timeout: 60_000 },
  )

  effect(
    "--since refuses a baseline and fails on a ref git cannot resolve",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            yield* commitAll(root)
            const unknownRef = yield* safemods(root, ["--since", "no-such-ref"])
            expect(unknownRef.code).toBe(2)
            expect(unknownRef.stdout).toContain("GitFailure")
            expect(unknownRef.stdout).toContain("ambiguous argument 'no-such-ref'")

            yield* write(root, "known.json", "[]\n")
            const conflicting = yield* safemods(root, [
              "--since",
              "HEAD",
              "--baseline",
              "known.json",
            ])
            expect(conflicting.code).toBe(2)
            expect(conflicting.stdout).toContain("SinceWithBaseline")
          }),
        { fixture: "empty", files: sinceFixture },
      ),
    { timeout: 30_000 },
  )
})
