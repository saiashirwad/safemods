import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import type { Identifier } from "typescript/unstable/ast"
import { withProject } from "./utils/project-fixture.ts"
import * as Query from "../src/Query/index.ts"

const nameMatches = (pattern: RegExp) =>
  Query.Criterion.predicate<Identifier>(`name-matches:${String(pattern)}`, (selection) =>
    pattern.test(selection.value.text) ? { matchedText: selection.value.text } : undefined,
  )

const NAMES_SOURCE = [
  "export const alpha = 1",
  "export const beta = 2",
  "const gamma = 3",
  "",
].join("\n")

describe("Query criterion combinators", () => {
  const inNames = <A, E, R>(self: Query.Query<A, E, R>): Query.Query<A, E, R> =>
    Query.within(self, "src/names.ts")

  effect(
    "all admits selections every criterion admits, merging their facts",
    () =>
      withProject({ "src/names.ts": NAMES_SOURCE }, (project) =>
        Effect.gen(function* () {
          const surviving = yield* Query.identifiers(project).pipe(
            inNames,
            Query.where(Query.Criterion.all(nameMatches(/^alpha$/), nameMatches(/lph/))),
            Query.collect,
          )
          expect(surviving.map((selection) => selection.value.text)).toEqual(["alpha"])
        }),
      ),
    60_000,
  )

  effect(
    "any admits selections at least one criterion admits and records which one",
    () =>
      withProject({ "src/names.ts": NAMES_SOURCE }, (project) =>
        Effect.gen(function* () {
          const surviving = yield* Query.identifiers(project).pipe(
            inNames,
            Query.where(Query.Criterion.any(nameMatches(/^alpha$/), nameMatches(/^beta$/))),
            Query.collect,
          )
          expect(surviving.map((selection) => selection.value.text)).toEqual(["alpha", "beta"])
          expect(surviving[0]!.evidence.at(-1)?.facts.criterion).toBe("name-matches:/^alpha$/")
          expect(surviving[1]!.evidence.at(-1)?.facts.criterion).toBe("name-matches:/^beta$/")
        }),
      ),
    60_000,
  )

  effect(
    "not admits selections the criterion rejects and records the negation",
    () =>
      withProject({ "src/names.ts": NAMES_SOURCE }, (project) =>
        Effect.gen(function* () {
          const surviving = yield* Query.identifiers(project).pipe(
            inNames,
            Query.where(Query.Criterion.not(nameMatches(/^alpha$/))),
            Query.collect,
          )
          expect(surviving.map((selection) => selection.value.text)).toEqual(["beta", "gamma"])
          expect(surviving[0]!.evidence.at(-1)?.facts.negated).toBe("name-matches:/^alpha$/")
        }),
      ),
    60_000,
  )

  effect(
    "combinators nest: all(any(...), not(...)) intersects union and complement",
    () =>
      withProject({ "src/names.ts": NAMES_SOURCE }, (project) =>
        Effect.gen(function* () {
          const surviving = yield* Query.identifiers(project).pipe(
            inNames,
            Query.where(
              Query.Criterion.all(
                Query.Criterion.any(nameMatches(/^alpha$/), nameMatches(/^beta$/)),
                Query.Criterion.not(nameMatches(/^alpha$/)),
              ),
            ),
            Query.collect,
          )
          expect(surviving.map((selection) => selection.value.text)).toEqual(["beta"])
        }),
      ),
    60_000,
  )
})
