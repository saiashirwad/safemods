import { Data, Effect, Order } from "effect"
import { reasonOf } from "./Reason.ts"
import type * as Finding from "./Finding.ts"
import * as Position from "./Position.ts"
import type * as WorkspacePath from "./WorkspacePath.ts"
import {
  type ProjectSnapshot,
  WorkspaceService,
  type WorkspaceSnapshot,
} from "./Workspace/index.ts"

/** Reports at a selection, or at the start of a file when given only the file. */
export const report = (
  at: { readonly fileName: WorkspacePath.Type } & Partial<Finding.Location>,
  message: string,
): Finding.Issue => ({
  fileName: at.fileName,
  start: at.start ?? 0,
  end: at.end ?? 0,
  message,
})

export interface Definition<E = never, R = never> {
  readonly name: string
  readonly run: (snapshot: WorkspaceSnapshot) => Effect.Effect<ReadonlyArray<Finding.Issue>, E, R>
}

export class CheckError extends Data.TaggedError("CheckError")<{
  readonly check: string
  readonly cause: unknown
}> {
  override readonly message = `Check ${this.check} failed: ${reasonOf(this.cause)}`
}

export const define = <E, R>(
  name: string,
  run: (snapshot: WorkspaceSnapshot) => Effect.Effect<ReadonlyArray<Finding.Issue>, E, R>,
): Definition<E, R> => ({ name, run })

export const each = <A, E, R>(
  items: Iterable<A>,
  reportsFor: (item: A) => Effect.Effect<ReadonlyArray<Finding.Issue>, E, R>,
  concurrency: number | "unbounded" = "unbounded",
): Effect.Effect<ReadonlyArray<Finding.Issue>, E, R> =>
  Effect.map(Effect.forEach(items, reportsFor, { concurrency }), (reports) => reports.flat())

export const perProject = <E, R>(
  name: string,
  reportsFor: (project: ProjectSnapshot) => Effect.Effect<ReadonlyArray<Finding.Issue>, E, R>,
): Definition<E, R> =>
  define(
    name,
    (snapshot) => each(snapshot.projects, reportsFor),
  )

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

const collect = <E, R>(checks: ReadonlyArray<Definition<E, R>>) => (snapshot: WorkspaceSnapshot) =>
  Effect.gen(function* () {
    const reported = yield* Effect.forEach(
      checks,
      (check) =>
        check.run(snapshot).pipe(
          Effect.map((reports) => reports.map((found) => ({ ...found, check: check.name }))),
          Effect.mapError((cause) => new CheckError({ check: check.name, cause })),
        ),
      { concurrency: "unbounded" },
    )
    const locators = new Map<WorkspacePath.Type, Position.Locator>()
    const byFile = new Map<WorkspacePath.Type, Array<Result>>()
    for (const found of reported.flat()) {
      let at = locators.get(found.fileName)
      if (at === undefined) {
        const [file] = yield* snapshot.files(found.fileName)
        at = Position.locator(file?.sourceFile.text ?? "")
        locators.set(found.fileName, at)
      }
      const result: Result = { ...found, ...at(found.start) }
      const matches = byFile.get(result.fileName)
      if (
        matches?.some((other) =>
          other.start === result.start && other.end === result.end &&
          other.check === result.check && other.message === result.message
        )
      ) continue
      if (matches === undefined) byFile.set(result.fileName, [result])
      else matches.push(result)
    }
    return [...byFile.values()].flat().sort(byPosition)
  })

export const run = <E, R>(checks: ReadonlyArray<Definition<E, R>>) =>
  Effect.flatMap(WorkspaceService, (workspace) => workspace.withSnapshot(collect(checks)))

export const format = ({ check, fileName, line, column, message }: Result): string =>
  `${fileName}:${line}:${column} ${check} ${message}`
