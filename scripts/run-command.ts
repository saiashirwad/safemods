import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

/** Spawn a child, draining both streams, and return its output with its exit code. */
export const runCommand = Effect.fn("runCommand")(function* (
  executable: string,
  args: ReadonlyArray<string>,
  cwd: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(executable, args, { cwd, stdin: "ignore" }),
      )
      return yield* Effect.all({
        stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
        stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
        exitCode: handle.exitCode,
      }, { concurrency: "unbounded" })
    }),
  )
})
