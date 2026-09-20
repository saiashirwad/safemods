import * as Path from "node:path"
import { Data, Effect, Order, Schema } from "effect"
import { type Comparison, withComparison } from "./Comparison.ts"
import type * as ProjectId from "./ProjectId.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"
import type { Selection } from "./Query.ts"
import { type ProjectSnapshot, Workspace, WorkspaceSnapshot } from "./Workspace/index.ts"
import type { Overlay } from "./Workspace/Overlay.ts"

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

export const reportAt = (
  project: ProjectSnapshot,
  fileName: ProjectRelativePath.Type,
  message: string,
): Report => ({ projectId: project.project.id, fileName, start: 0, message })

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
  readonly comparisons?: ReadonlyArray<Check<unknown, WorkspaceSnapshot | Comparison>>
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

export const sorted = (findings: ReadonlyArray<Finding>): ReadonlyArray<Finding> =>
  [...findings].sort(byPosition)

const collect = <E, R>(checks: ReadonlyArray<Check<E, R>>) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
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
    return sorted(findings)
  })

export const run = <E>(checks: ReadonlyArray<Check<E>>, overlay?: Overlay) =>
  Effect.flatMap(Workspace, (workspace) => workspace.withSnapshot(collect(checks), overlay))

export const runCompared = <E>(
  comparisons: ReadonlyArray<Check<E, WorkspaceSnapshot | Comparison>>,
  previous: ReadonlyMap<string, string>,
) => withComparison(previous, collect(comparisons))

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
