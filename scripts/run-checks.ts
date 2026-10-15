import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Path } from "effect"
import { runCommand } from "./run-command.ts"

/** A Node script to run from the repo root, with optional Node flags. */
export interface Check {
  readonly label: string
  readonly script: string
  readonly args: ReadonlyArray<string>
  readonly nodeArgs?: ReadonlyArray<string>
}

/**
 * Run every check concurrently, even when one fails, then print one labelled
 * section per failure and set a non-zero exit code once. Silent on success.
 */
const runChecks = (checks: ReadonlyArray<Check>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const root = yield* path.fromFileUrl(new URL("..", import.meta.url))
    const outcomes = yield* Effect.forEach(
      checks,
      (check) =>
        runCommand(
          process.execPath,
          [...check.nodeArgs ?? [], check.script, ...check.args],
          root,
        ).pipe(Effect.map((result) => ({ check, result }))),
      { concurrency: "unbounded" },
    )
    const failures = outcomes.filter(({ result }) => result.exitCode !== 0)
    for (const { check, result } of failures) {
      yield* Console.error(`\n=== ${check.label} (exit ${result.exitCode}) ===`)
      yield* Console.error([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"))
    }
    if (failures.length > 0) {
      yield* Console.error(`\nFailed: ${failures.map(({ check }) => check.label).join(", ")}`)
      process.exitCode = 1
    }
  })

export const main = (checks: ReadonlyArray<Check>) =>
  NodeRuntime.runMain(runChecks(checks).pipe(Effect.provide(NodeServices.layer)))

export const oxlint: Check = { label: "oxlint", script: "node_modules/oxlint/bin/oxlint", args: [] }
export const knip: Check = { label: "knip", script: "node_modules/knip/bin/knip.js", args: [] }
export const dprint: Check = {
  label: "dprint",
  script: "node_modules/dprint/bin.cjs",
  args: ["check"],
}
export const tsc: Check = {
  label: "tsc",
  script: "node_modules/typescript/bin/tsc",
  args: ["--noEmit"],
}
export const selfCheck: Check = {
  label: "safemods check",
  nodeArgs: ["--conditions=source"],
  script: "src/bin.ts",
  args: ["check"],
}
