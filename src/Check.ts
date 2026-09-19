import * as Path from "node:path"
import { Data, Effect, Order, Schema } from "effect"
import type * as ProjectId from "./ProjectId.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"
import type { Selection } from "./Query.ts"
import { Workspace, WorkspaceSnapshot } from "./Workspace/index.ts"

export interface Report {
  readonly projectId: ProjectId.Type
  readonly fileName: ProjectRelativePath.Type
  readonly start: number
  readonly message: string
}

export const report = <A>(selection: Selection<A>, message: string): Report => ({
  projectId: selection.project.project.id,
  fileName: selection.fileName,
  start: selection.start,
  message,
})

export interface Check<E = never, R = WorkspaceSnapshot> {
  readonly name: string
  readonly run: Effect.Effect<ReadonlyArray<Report>, E, R>
}

export class CheckError extends Data.TaggedError("CheckError")<{
  readonly check: string
  readonly cause: unknown
}> {}

export const define = <E, R>(
  name: string,
  run: Effect.Effect<ReadonlyArray<Report>, E, R>,
): Check<E, R> => ({ name, run })

export interface Config {
  readonly projects: ReadonlyArray<{ readonly id: string; readonly config: string }>
  readonly checks: ReadonlyArray<Check<unknown>>
}

export const Finding = Schema.Struct({
  check: Schema.String,
  path: Schema.String,
  line: Schema.Int,
  column: Schema.Int,
  message: Schema.String,
})
export type Finding = typeof Finding.Type

export const Known = Schema.Struct({
  check: Schema.String,
  path: Schema.String,
  message: Schema.String,
})
export type Known = typeof Known.Type

const byPosition = Order.Struct({
  path: Order.String,
  line: Order.Number,
  column: Order.Number,
  check: Order.String,
  message: Order.String,
})

export const run = <E, R>(checks: ReadonlyArray<Check<E, R>>) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    return yield* workspace.withSnapshot(
      Effect.gen(function* () {
        const snapshot = yield* WorkspaceSnapshot
        const reported = yield* Effect.forEach(
          checks,
          (check) =>
            check.run.pipe(
              Effect.map((reports) => reports.map((found) => ({ ...found, check: check.name }))),
              Effect.mapError((cause) => new CheckError({ check: check.name, cause })),
            ),
          { concurrency: "unbounded" },
        )
        const findings = yield* Effect.forEach(reported.flat(), (found) =>
          Effect.gen(function* () {
            const project = yield* snapshot.project(found.projectId)
            const file = yield* project.file(found.fileName)
            const before = (file?.sourceFile.text ?? "").slice(0, found.start)
            const absolute = yield* workspace.absolutePath(found)
            return {
              check: found.check,
              path: Path.relative(workspace.root, absolute).replaceAll(Path.sep, "/"),
              line: before.split("\n").length,
              column: found.start - before.lastIndexOf("\n"),
              message: found.message,
            } satisfies Finding
          }),
        )
        return findings.sort(byPosition)
      }),
    )
  })

const identity = ({ check, path, message }: Known): string => JSON.stringify([check, path, message])

export const introducedSince = (
  known: ReadonlyArray<Known>,
  findings: ReadonlyArray<Finding>,
): ReadonlyArray<Finding> => {
  const remaining = Map.groupBy(known, identity)
  return findings.filter((finding) => remaining.get(identity(finding))?.pop() === undefined)
}

export const format = ({ check, path, line, column, message }: Finding): string =>
  `${path}:${line}:${column} ${check} ${message}`
