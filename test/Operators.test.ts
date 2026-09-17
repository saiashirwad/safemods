import { describe, effect, expect } from "@effect/vitest"
import { Effect, Predicate } from "effect"
import { and, refineKey } from "is-kit"
import type { CallExpression, Expression, Identifier } from "typescript/unstable/ast"
import { isCallExpression } from "typescript/unstable/ast/is"
import type { ProjectFile } from "../src/Workspace/index.ts"
import { withProject } from "./utils/project-fixture.ts"
import * as Query from "../src/Query/index.ts"

const ARITY_SOURCE = [
  "export function run(): void {",
  "  zero();",
  "  one(1);",
  "  two(1, 2);",
  "  three(1, 2, 3);",
  "}",
  "function zero(): void {}",
  "function one(a: number): void {}",
  "function two(a: number, b: number): void {}",
  "function three(a: number, b: number, c: number): void {}",
  "",
].join("\n")

const inArity = <A, E, R>(self: Query.Query<A, E, R>): Query.Query<A, E, R> =>
  Query.within(self, "src/arity.ts")

const isBinaryCall = and(
  isCallExpression,
  refineKey("arguments", Predicate.isTupleOf(2)<Expression>),
)

const hasTwoArguments = refineKey("value", isBinaryCall)

describe("Query stream operators", () => {
  effect(
    "where admits only selections the criterion gives facts, appending its evidence",
    () =>
      withProject(
        { "src/tiny.ts": "export const alpha = 1\nexport const beta = 2\n" },
        (project) => {
          const inTiny = <A, E, R>(self: Query.Query<A, E, R>): Query.Query<A, E, R> =>
            Query.within(self, "src/tiny.ts")
          return Effect.gen(function* () {
            const isAlpha: Query.Criterion<Identifier> = {
              id: "name-is-alpha",
              select: (selections) =>
                Effect.sync(() =>
                  selections.map((selection) =>
                    selection.value.text === "alpha" ? { text: "alpha" } : undefined,
                  ),
                ),
            }
            const surviving = yield* Query.identifiers(project).pipe(
              inTiny,
              Query.where(isAlpha),
              Query.collect,
            )
            expect(surviving.map((selection) => selection.value.text)).toEqual(["alpha"])
            const last = surviving[0]!.evidence.at(-1)!
            expect(last.criterion).toBe("name-is-alpha")
            expect(last.facts).toEqual({ text: "alpha" })
          })
        },
      ),
    60_000,
  )

  effect(
    "where groups selections into batches of the criterion's batchSize",
    () =>
      withProject({ "src/arity.ts": ARITY_SOURCE }, (project) =>
        Effect.gen(function* () {
          const batchSizes: Array<number> = []
          const batched: Query.Criterion<CallExpression> = {
            id: "record-batch",
            batchSize: 2,
            select: (selections) =>
              Effect.sync(() => {
                batchSizes.push(selections.length)
                return selections.map(() => ({ seen: true }))
              }),
          }
          const surviving = yield* Query.calls(project).pipe(
            inArity,
            Query.where(batched),
            Query.collect,
          )
          // four call expressions: zero(), one(1), two(1, 2), three(1, 2, 3)
          expect(surviving).toHaveLength(4)
          expect(batchSizes).toEqual([2, 2])
          expect(
            surviving.every((selection) => selection.evidence.at(-1)?.criterion === "record-batch"),
          ).toBe(true)
        }),
      ),
    60_000,
  )

  effect(
    "where fails with QueryContractError when a criterion returns a misaligned batch",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const misaligned: Query.Criterion<Identifier> = {
            id: "misaligned",
            select: () => Effect.succeed([]),
          }
          const error = yield* Effect.flip(
            Query.identifiers(project).pipe(Query.where(misaligned), Query.collect),
          )
          expect(error._tag).toBe("QueryContractError")
        }),
      ),
    60_000,
  )

  effect(
    "filter narrows by selection predicate",
    () =>
      withProject({ "src/arity.ts": ARITY_SOURCE }, (project) =>
        Effect.gen(function* () {
          const binary = yield* Query.calls(project).pipe(
            inArity,
            Query.filter(hasTwoArguments),
            Query.collect,
          )
          expect(binary).toHaveLength(1)
          expect(binary[0]!.value.getText()).toBe("two(1, 2)")
          const [left, right] = binary[0]!.value.arguments
          expect([left.getText(), right.getText()]).toEqual(["1", "2"])
        }),
      ),
    60_000,
  )

  effect(
    "within admits by glob, exact path, regular expression, and exact ProjectFile",
    () =>
      withProject(
        {
          "src/question?.ts": "export const question = 1\n",
          "src/nested/deep.ts": "export const deep = 1\n",
        },
        (project) => {
          const countIn = (pattern: string | RegExp | ProjectFile) =>
            Query.identifiers(project).pipe(Query.within(pattern), Query.collect)

          return Effect.gen(function* () {
            const all = yield* countIn("src/**/*.ts")
            const topLevel = yield* countIn("src/*.ts")
            const portableTopLevel = yield* countIn("src\\*.ts")
            const literalQuestion = yield* countIn("src/question?.ts")
            const libraryOnly = yield* countIn("src/library.ts")
            const regExp = yield* countIn(/reexport-consumer/)
            const files = yield* project.files
            const library = files.find((file) => file.path === "src/library.ts")
            expect(library).toBeDefined()

            expect(all.length).toBeGreaterThan(0)
            expect(libraryOnly.length).toBeGreaterThan(0)
            expect(libraryOnly.every((s) => s.fileName === "src/library.ts")).toBe(true)
            expect(regExp.every((s) => s.fileName.includes("reexport-consumer"))).toBe(true)
            expect((yield* countIn(library!)).every((s) => s.fileName === "src/library.ts")).toBe(
              true,
            )

            // Bare strings are exact: no substring or suffix matching.
            expect(yield* countIn("library.ts")).toEqual([])
            expect(yield* countIn("consumer")).toEqual([])
            expect(topLevel.some((selection) => selection.fileName === "src/question?.ts")).toBe(
              true,
            )
            expect(topLevel.some((selection) => selection.fileName === "src/nested/deep.ts")).toBe(
              false,
            )
            expect(all.some((selection) => selection.fileName === "src/nested/deep.ts")).toBe(true)
            expect(portableTopLevel.map((selection) => selection.fileName)).toEqual(
              topLevel.map((selection) => selection.fileName),
            )
            expect(literalQuestion.length).toBeGreaterThan(0)
            expect(
              literalQuestion.every((selection) => selection.fileName === "src/question?.ts"),
            ).toBe(true)
          })
        },
      ),
    60_000,
  )
})
