import * as Path from "node:path"
import { Data, Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

export class GitFailure extends Data.TaggedError("GitFailure")<{
  readonly args: ReadonlyArray<string>
  readonly cause: unknown
}> {}

export interface Changes {
  readonly previous: ReadonlyMap<string, string>
  readonly added: ReadonlySet<string>
}

const git = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, GitFailure, ChildProcessSpawner> =>
  Effect.gen(function* () {
    const handle = yield* ChildProcess.make("git", args, { cwd })
    const [output, failure] = yield* Effect.all(
      [
        Stream.mkString(Stream.decodeText(handle.stdout)),
        Stream.mkString(Stream.decodeText(handle.stderr)),
      ],
      { concurrency: 2 },
    )
    const exitCode = yield* handle.exitCode
    return exitCode === 0
      ? output
      : yield* new GitFailure({ args, cause: failure.trim() || `git exited with ${exitCode}` })
  }).pipe(
    Effect.scoped,
    Effect.mapError((cause) =>
      cause instanceof GitFailure ? cause : new GitFailure({ args, cause }),
    ),
  )

const entries = (output: string): ReadonlyArray<string> =>
  output.split("\0").filter((entry) => entry !== "")

const statusesOf = (output: string): ReadonlyArray<readonly [string, string]> => {
  const fields = entries(output)
  const statuses: Array<readonly [string, string]> = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    statuses.push([fields[index]!, fields[index + 1]!])
  }
  return statuses
}

export const changesSince = (
  root: string,
  ref: string,
): Effect.Effect<Changes, GitFailure, ChildProcessSpawner> =>
  Effect.gen(function* () {
    const statuses = statusesOf(
      yield* git(root, ["diff", "--name-status", "--no-renames", "-z", "--relative", ref]),
    )
    const untracked = entries(
      yield* git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    )
    const added = new Set(
      [...untracked, ...statuses.filter(([status]) => status === "A").map(([, name]) => name)].map(
        (name) => Path.resolve(root, name),
      ),
    )
    const previous = new Map(
      yield* Effect.forEach(
        statuses.filter(([status]) => status !== "A"),
        ([, name]) =>
          Effect.map(
            git(root, ["show", `${ref}:./${name}`]),
            (text) => [Path.resolve(root, name), text] as const,
          ),
        { concurrency: 16 },
      ),
    )
    return { previous, added }
  })
