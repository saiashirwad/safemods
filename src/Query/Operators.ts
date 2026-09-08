/** Generic query stream operators. */
import { matchesGlob } from "node:path"
import { Effect, Function, Predicate, Stream } from "effect"
import { isProjectFile, type ProjectFile } from "../Workspace/ProjectSnapshot.ts"
import { type Criterion, type Query, QueryContractError, type Selection } from "./Query.ts"

const testRegExp = (pattern: RegExp, value: string): boolean => {
  if (!pattern.global && !pattern.sticky) return pattern.test(value)
  const lastIndex = pattern.lastIndex
  try {
    pattern.lastIndex = 0
    return pattern.test(value)
  } finally {
    pattern.lastIndex = lastIndex
  }
}

/** Admit only selections the criterion produces evidence for. */
export const where = Function.dual<
  <A, E2, R2>(
    criterion: Criterion<A, E2, R2>,
  ) => <E, R>(self: Query<A, E, R>) => Query<A, E | E2 | QueryContractError, R | R2>,
  <A, E, R, E2, R2>(
    self: Query<A, E, R>,
    criterion: Criterion<A, E2, R2>,
  ) => Query<A, E | E2 | QueryContractError, R | R2>
>(2, (self, criterion) =>
  self.pipe(
    Stream.grouped(criterion.batchSize ?? 128),
    Stream.mapEffect((batch) =>
      Effect.gen(function* () {
        const facts = yield* criterion.select(batch)
        if (facts.length !== batch.length) {
          return yield* new QueryContractError({
            criterion: criterion.id,
            expected: batch.length,
            actual: facts.length,
          })
        }
        return batch.flatMap((selection, index) => {
          const selectedFacts = facts[index]
          return selectedFacts === undefined
            ? []
            : [
                {
                  ...selection,
                  evidence: [
                    ...selection.evidence,
                    { criterion: criterion.id, facts: selectedFacts },
                  ],
                },
              ]
        })
      }),
    ),
    Stream.flatMap((batch) => Stream.fromIterable(batch)),
  ),
)

/** Selection-level predicate filter; evidence of surviving selections is preserved. */
export const filter = Function.dual<
  <A>(
    predicate: (selection: Selection<A>) => boolean,
  ) => <E, R>(self: Query<A, E, R>) => Query<A, E, R>,
  <A, E, R>(self: Query<A, E, R>, predicate: (selection: Selection<A>) => boolean) => Query<A, E, R>
>(2, (self, predicate) => Stream.filter(self, predicate))

/**
 * Run a query to completion in canonical plan order: project ID,
 * project-relative file, start, end. Discovery timing never controls order.
 */
export const collect = <A, E, R>(
  self: Query<A, E, R>,
): Effect.Effect<ReadonlyArray<Selection<A>>, E, R> =>
  Stream.runCollect(self).pipe(
    Effect.map((selections) =>
      [...selections].sort(
        (left, right) =>
          left.project.project.id.localeCompare(right.project.project.id) ||
          left.fileName.localeCompare(right.fileName) ||
          left.start - right.start ||
          left.end - right.end,
      ),
    ),
  )

const matchesPathGlob = (fileName: string, glob: string): boolean =>
  matchesGlob(fileName.replaceAll("\\", "/"), glob.replaceAll("\\", "/"))

/**
 * Filter selections by project-relative file name. A string containing `*`
 * is a documented `*` / `**` glob; any other string must equal the file name
 * exactly. Regular expressions test the file name; a ProjectFile selects
 * that one file.
 */
export const within = Function.dual<
  <A>(pattern: string | RegExp | ProjectFile) => <E, R>(query: Query<A, E, R>) => Query<A, E, R>,
  <A, E, R>(query: Query<A, E, R>, pattern: string | RegExp | ProjectFile) => Query<A, E, R>
>(2, (query, pattern) => {
  if (isProjectFile(pattern)) {
    return Stream.filter(
      query,
      (selection) =>
        selection.project.project.id === pattern.project.project.id &&
        selection.fileName === pattern.path,
    )
  }
  const predicate = Predicate.isString(pattern)
    ? (fileName: string) =>
        pattern.includes("*") ? matchesPathGlob(fileName, pattern) : fileName === pattern
    : (fileName: string) => testRegExp(pattern, fileName)

  return Stream.filter(query, (selection) => predicate(selection.fileName))
})
