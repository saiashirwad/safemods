import { describe, effect, expect } from "@effect/vitest"
import { Effect, Exit, Predicate } from "effect"
import { and, refineKey } from "is-kit"
import { SyntaxKind, type Expression, type Identifier } from "typescript/unstable/ast"
import {
  isCallExpression,
  isFunctionDeclaration,
  isNumericLiteral,
} from "typescript/unstable/ast/is"
import * as Query from "../src/Query.ts"
import { projectPath } from "./utils/domain.ts"
import { withProject } from "./utils/fixture.ts"

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

const SEM_SOURCE = [
  "export function oldThing(value: number): number {",
  "  return value + 1",
  "}",
  "",
  "oldThing(1);",
  "",
].join("\n")

const hasTwoArguments = refineKey(
  "value",
  and(isCallExpression, refineKey("arguments", Predicate.isTupleOf(2)<Expression>)),
)

describe("queries", () => {
  effect(
    "sources stay on project-owned files",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const files = yield* project.files
          const owned = new Set(files.map((file) => file.fileName))
          const fromProject = yield* Query.collect(Query.identifiers(project))
          const fromFiles = yield* Query.collect(Query.identifiers(files))

          expect(owned).toEqual(
            new Set([
              "src/barrel.ts",
              "src/consumer.ts",
              "src/library.ts",
              "src/reexport-consumer.ts",
            ]),
          )
          expect(fromProject.length).toBeGreaterThan(0)
          expect(fromProject.length).toBe(fromFiles.length)
          expect(fromProject.every((selection) => owned.has(selection.fileName))).toBe(true)
        }),
      ),
    60_000,
  )

  effect(
    "file scopes restrict a query and ignore repeated files",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const library = yield* project.file(projectPath("src/library.ts"))
          const consumer = yield* project.file(projectPath("src/consumer.ts"))
          const consumerAgain = yield* project.file(projectPath("src/consumer.ts"))
          expect(yield* project.file(projectPath("src/absent.ts"))).toBeUndefined()

          const exported = yield* Query.nodes([library!, consumer!], isFunctionDeclaration).pipe(
            Query.filter(
              ({ value }) =>
                value.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ??
                false,
            ),
            Query.collect,
          )
          expect(exported.map((selection) => selection.fileName)).toEqual([
            "src/library.ts",
            "src/library.ts",
          ])

          const once = yield* Query.collect(Query.calls([consumer!]))
          const twice = yield* Query.collect(Query.calls([consumer!, consumerAgain!]))
          expect(twice.length).toBe(once.length)
          expect(yield* Query.collect(Query.calls([]))).toEqual([])
        }),
      ),
    60_000,
  )

  effect(
    "where admits only selections that satisfy the criterion",
    () =>
      withProject({ "src/tiny.ts": "export const alpha = 1\nexport const beta = 2\n" }, (project) =>
        Effect.gen(function* () {
          const isAlpha: Query.Criterion<Identifier> = {
            id: "name-is-alpha",
            select: (selections) =>
              Effect.succeed(selections.map((selection) => selection.value.text === "alpha")),
          }
          const surviving = yield* Query.identifiers(project).pipe(
            Query.within("src/tiny.ts"),
            Query.where(isAlpha),
            Query.collect,
          )
          expect(surviving.map((selection) => selection.value.text)).toEqual(["alpha"])
        }),
      ),
    60_000,
  )

  effect(
    "where dies when a criterion answers for the wrong number of selections",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const misaligned: Query.Criterion<Identifier> = {
            id: "misaligned",
            select: () => Effect.succeed([]),
          }
          const exit = yield* Query.identifiers(project).pipe(
            Query.where(misaligned),
            Query.collect,
            Effect.exit,
          )
          expect(Exit.hasDies(exit)).toBe(true)
        }),
      ),
    60_000,
  )

  effect(
    "filter narrows the selected node type",
    () =>
      withProject({ "src/arity.ts": ARITY_SOURCE }, (project) =>
        Effect.gen(function* () {
          const binary = yield* Query.calls(project).pipe(
            Query.within("src/arity.ts"),
            Query.filter(hasTwoArguments),
            Query.collect,
          )
          expect(binary).toHaveLength(1)
          const [left, right] = binary[0]!.value.arguments
          expect([left.getText(), right.getText()]).toEqual(["1", "2"])
        }),
      ),
    60_000,
  )

  effect(
    "within matches globs when the pattern has a wildcard and exact paths otherwise",
    () =>
      withProject(
        {
          "src/question?.ts": "export const question = 1\n",
          "src/nested/deep.ts": "export const deep = 1\n",
        },
        (project) =>
          Effect.gen(function* () {
            const filesIn = (pattern: string) =>
              Query.identifiers(project).pipe(
                Query.within(pattern),
                Query.collect,
                Effect.map((selections) => new Set<string>(selections.map((s) => s.fileName))),
              )

            expect((yield* filesIn("src/**/*.ts")).has("src/nested/deep.ts")).toBe(true)
            expect((yield* filesIn("src/*.ts")).has("src/nested/deep.ts")).toBe(false)
            expect((yield* filesIn("src/*.ts")).has("src/question?.ts")).toBe(true)
            expect(yield* filesIn("src\\*.ts")).toEqual(yield* filesIn("src/*.ts"))
            expect(yield* filesIn("src/library.ts")).toEqual(new Set(["src/library.ts"]))
            expect(yield* filesIn("src/question?.ts")).toEqual(new Set(["src/question?.ts"]))
            expect(yield* filesIn("library.ts")).toEqual(new Set())
          }),
      ),
    60_000,
  )

  effect(
    "resolvesTo follows a symbol across files",
    () =>
      withProject(
        {
          "src/sem.ts": SEM_SOURCE,
          "src/sem-consumer.ts": 'import { oldThing as legacy } from "./sem.js"\nlegacy(2)\n',
          "src/sem-shadow.ts": "const oldThing = (n: number) => n\noldThing(3)\n",
        },
        (project) =>
          Effect.gen(function* () {
            const symbol = yield* project.symbolNamed("oldThing", {
              within: projectPath("src/sem.ts"),
            })
            const references = yield* Query.identifiers(project).pipe(
              Query.where(Query.resolvesTo(symbol)),
              Query.collect,
            )
            expect(
              references.map((selection) => `${selection.fileName}:${selection.value.text}`),
            ).toEqual([
              "src/sem-consumer.ts:oldThing",
              "src/sem-consumer.ts:legacy",
              "src/sem-consumer.ts:legacy",
              "src/sem.ts:oldThing",
              "src/sem.ts:oldThing",
            ])
          }),
      ),
    60_000,
  )

  effect(
    "typeAssignableTo admits nodes by their checked type",
    () =>
      withProject({ "src/sem.ts": SEM_SOURCE }, (project) =>
        Effect.gen(function* () {
          const literals = Query.nodes(project, isNumericLiteral).pipe(Query.within("src/sem.ts"))
          const numbers = yield* literals.pipe(
            Query.where(Query.typeAssignableTo("number")),
            Query.collect,
          )
          expect(numbers.map((selection) => selection.value.text)).toEqual(["1", "1"])

          const strings = yield* literals.pipe(
            Query.where(Query.typeAssignableTo("string")),
            Query.collect,
          )
          expect(strings).toEqual([])
        }),
      ),
    60_000,
  )
})
