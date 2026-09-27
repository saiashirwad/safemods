import { Data, Effect, Order } from "effect"
import * as Finding from "./Finding.ts"
import type { Selection } from "./Query.ts"
import type * as WorkspacePath from "./WorkspacePath.ts"
import { type ProjectSnapshot, Workspace, WorkspaceSnapshot } from "./Workspace/index.ts"

export const report = <A>(selection: Selection<A>, message: string): Finding.Finding => ({
  fileName: selection.fileName,
  start: selection.start,
  end: selection.end,
  message,
})

export const reportAt = (fileName: WorkspacePath.Type, message: string): Finding.Finding => ({
  fileName,
  start: 0,
  end: 0,
  message,
})

export interface Check<E = never, R = WorkspaceSnapshot> {
  readonly name: string
  readonly run: Effect.Effect<ReadonlyArray<Finding.Finding>, E, R>
}

export class CheckError extends Data.TaggedError("CheckError")<{
  readonly check: string
  readonly cause: unknown
}> {}

export const define = <E, R>(
  name: string,
  run: Effect.Effect<ReadonlyArray<Finding.Finding>, E, R>,
): Check<E, R> => ({ name, run })

export const each = <A, E, R>(
  items: Iterable<A>,
  reportsFor: (item: A) => Effect.Effect<ReadonlyArray<Finding.Finding>, E, R>,
  concurrency: number | "unbounded" = "unbounded",
): Effect.Effect<ReadonlyArray<Finding.Finding>, E, R> =>
  Effect.map(Effect.forEach(items, reportsFor, { concurrency }), (reports) => reports.flat())

export const perProject = <E, R>(
  name: string,
  reportsFor: (project: ProjectSnapshot) => Effect.Effect<ReadonlyArray<Finding.Finding>, E, R>,
): Check<E, R | WorkspaceSnapshot> =>
  define(
    name,
    WorkspaceSnapshot.use((snapshot) => each(snapshot.projects, reportsFor)),
  )

export interface Config {
  readonly projects: ReadonlyArray<{ readonly id: string; readonly config: string }>
  readonly checks: ReadonlyArray<Check<unknown>>
}

export interface Result extends Finding.Located {
  readonly check: string
}

const byPosition = Order.Struct({
  fileName: Order.String,
  line: Order.Number,
  column: Order.Number,
  check: Order.String,
  message: Order.String,
})

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
    const results = yield* Effect.forEach(reported.flat(), (found) =>
      Effect.gen(function* () {
        const file = yield* snapshot.file(found.fileName)
        return Finding.locate(found, file?.sourceFile.text ?? "")
      }))
    return [...new Map(results.map((result) => [format(result), result])).values()].sort(byPosition)
  })

export const run = <E>(checks: ReadonlyArray<Check<E>>) =>
  Effect.flatMap(Workspace, (workspace) => workspace.withSnapshot(collect(checks)))

export const format = ({ check, fileName, line, column, message }: Result): string =>
  `${fileName}:${line}:${column} ${check} ${message}`
