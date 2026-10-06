/**
 * Point this checkout's git hooks at the committed `.githooks` directory.
 * Runs from the `prepare` script; CI and packed consumers skip it.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

const program = Effect.gen(function* () {
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
