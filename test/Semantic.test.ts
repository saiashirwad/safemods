import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { SyntaxKind, type NumericLiteral } from "typescript/unstable/ast"
import { isNumericLiteral } from "typescript/unstable/ast/is"
import type { ProjectSnapshot } from "../src/Workspace/index.ts"
import { withProject } from "./utils/project-fixture.ts"
import * as Query from "../src/Query/index.ts"

const SEM_SOURCE = [
  "/** @deprecated use nextThing */",
  "export function oldThing(value: number): number {",
  "  return value + 1",
  "}",
  "",
  "export function nextThing(value: number): number {",
  "  return value + 2",
  "}",
  "",
  "function localHelper(value: number): number {",
  "  return value * 2",
  "}",
  "",
  "oldThing(1);",
  "",
].join("\n")

const inSem = <A, E, R>(self: Query.Query<A, E, R>): Query.Query<A, E, R> =>
  Query.within(self, "src/sem.ts")

const numericLiterals = (project: ProjectSnapshot) =>
  Query.nodes<NumericLiteral>(project, isNumericLiteral, SyntaxKind.NumericLiteral).pipe(inSem)

describe("Query semantic criteria", () => {
  effect(
    "referencesTo finds canonical occurrences of a resolved symbol",
    () =>
      withProject(
        {
          "src/sem.ts": SEM_SOURCE,
          "src/sem-consumer.ts": ['import { oldThing } from "./sem.js"', "oldThing(2)", ""].join(
            "\n",
          ),
        },
        (project) =>
          Effect.gen(function* () {
            const symbol = yield* project.symbolNamed("oldThing", { within: "src/sem.ts" })

            const references = yield* Query.referencesTo(project, symbol).pipe(Query.collect)
            expect(
              references.map((selection) => `${selection.fileName}:${selection.value.text}`),
            ).toEqual([
              "src/sem-consumer.ts:oldThing",
              "src/sem-consumer.ts:oldThing",
              "src/sem.ts:oldThing",
              "src/sem.ts:oldThing",
            ])
          }),
      ),
    60_000,
  )

  effect(
    "typeAssignableTo admits nodes assignable to an intrinsic type and records the target",
    () =>
      withProject({ "src/sem.ts": SEM_SOURCE }, (project) =>
        Effect.gen(function* () {
          const numbers = yield* numericLiterals(project).pipe(
            Query.where(Query.typeAssignableTo("number")),
            Query.collect,
          )
          // Literal expressions carry literal types ("1", "2"), which are assignable to number.
          expect(new Set(numbers.map((selection) => selection.value.text))).toEqual(
            new Set(["1", "2"]),
          )
          expect(
            numbers.every(
              (selection) => selection.evidence.at(-1)?.facts.assignableTo === "number",
            ),
          ).toBe(true)

          const strings = yield* numericLiterals(project).pipe(
            Query.where(Query.typeAssignableTo("string")),
            Query.collect,
          )
          expect(strings).toEqual([])
        }),
      ),
    60_000,
  )
})
