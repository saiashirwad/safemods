import { Data, Effect, Order, Schema } from "effect"
import * as Position from "./Position.ts"
import type * as WorkspacePath from "./WorkspacePath.ts"
import type { Selection } from "./Query.ts"
import { type ProjectSnapshot, Workspace, WorkspaceSnapshot } from "./Workspace/index.ts"

export interface Report {
  readonly fileName: WorkspacePath.Type
  readonly start: number
  readonly message: string
}

export const report = <A>(selection: Selection<A>, message: string): Report => ({
  fileName: selection.fileName,
  start: selection.start,
  message,
})

export const reportAt = (fileName: WorkspacePath.Type, message: string): Report => ({
  fileName,
  start: 0,
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

export const each = <A, E, R>(
  items: Iterable<A>,
  reportsFor: (item: A) => Effect.Effect<ReadonlyArray<Report>, E, R>,
  concurrency: number | "unbounded" = "unbounded",
): Effect.Effect<ReadonlyArray<Report>, E, R> =>
  Effect.map(Effect.forEach(items, reportsFor, { concurrency }), (reports) => reports.flat())

export const perProject = <E, R>(
  name: string,
  reportsFor: (project: ProjectSnapshot) => Effect.Effect<ReadonlyArray<Report>, E, R>,
): Check<E, R | WorkspaceSnapshot> =>
  define(
    name,
    WorkspaceSnapshot.use((snapshot) => each(snapshot.projects, reportsFor)),
  )

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
        const file = yield* snapshot.file(found.fileName)
        return {
          check: found.check,
          path: found.fileName,
          ...Position.at(file?.sourceFile.text ?? "", found.start),
          message: found.message,
        } satisfies Finding
      }))
    return sorted([...new Map(findings.map((found) => [format(found), found])).values()])
  })

export const run = <E>(checks: ReadonlyArray<Check<E>>) =>
  Effect.flatMap(Workspace, (workspace) => workspace.withSnapshot(collect(checks)))

export const format = ({ check, path, line, column, message }: Finding): string =>
  `${path}:${line}:${column} ${check} ${message}`
