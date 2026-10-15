/**
 * `prepare` script: patch oxlint with the Effect rules, then point this
 * checkout's git hooks at the committed `.githooks` directory.
 * Silent on success; the patch output is shown only when it fails.
 * CI and packed consumers skip the hooks.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { runCommand } from "./run-command.ts"

const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const root = yield* path.fromFileUrl(new URL("..", import.meta.url))
  const patch = yield* runCommand(
    process.execPath,
    ["node_modules/@effect/tsgo/dist/effect-tsgo.cjs", "patch", "--no-typescript", "--oxlint"],
    root,
  )
  if (patch.exitCode !== 0) {
    yield* Console.error(patch.stdout, patch.stderr)
    process.exitCode = 1
    return
  }

  if (process.env.CI === "true" || process.env.SKIP_SAFEMODS_HOOKS === "1") return
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  yield* spawner.exitCode(
    ChildProcess.make("git", ["config", "core.hooksPath", ".githooks"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }),
  ).pipe(Effect.ignore)
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
