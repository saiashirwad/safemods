import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import type { Expression, Identifier, StringLiteral } from "typescript/unstable/ast"
import {
  isAwaitExpression,
  isBlock,
  isCallExpression,
  isIdentifier,
  isIfStatement,
  isReturnStatement,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import { expectTypeOf } from "vitest"
import * as P from "../src/Pattern.ts"
import * as Query from "../src/Query.ts"
import { withProject } from "./utils/fixture.ts"

const SOURCE = [
  "declare const flag: boolean",
  "declare const load: (name: string) => Promise<number>",
  "export function label(): string {",
  '  if (flag) { return "yes" } else { return "no" }',
  "}",
  "export function count(): number {",
  "  if (flag) { return 1 } else { return 2 }",
  "}",
  "export function both(): number {",
  "  if (flag) { load('a'); return 1 } else { return 2 }",
  "}",
  "export async function run(): Promise<number> {",
  "  return await load('b')",
  "}",
  "",
].join("\n")

const returns = <Name extends string>(name: Name) =>
  P.node(isBlock, {
    statements: [P.node(isReturnStatement, { expression: P.capture(name) })],
  })

const ifReturns = P.node(isIfStatement, {
  expression: P.capture("test"),
  thenStatement: returns("whenTrue"),
  elseStatement: returns("whenFalse"),
})

const awaited = P.node(isAwaitExpression, {
  expression: P.node(isCallExpression, {
    expression: P.bind("callee", P.node(isIdentifier)),
    arguments: [P.bind("argument", P.node(isStringLiteral))],
  }),
})

describe("patterns", () => {
  effect("captures take the type of the field they sit in", () =>
    Effect.sync(() => {
      expectTypeOf(ifReturns.match).returns.toEqualTypeOf<
        | {
          readonly test: Expression
          readonly whenTrue: Expression
          readonly whenFalse: Expression
        }
        | undefined
      >()
      expectTypeOf(awaited.match).returns.toEqualTypeOf<
        { readonly callee: Identifier; readonly argument: StringLiteral } | undefined
      >()
    }))

  effect("a field the node does not have is a type error", () =>
    Effect.sync(() => {
      // @ts-expect-error IfStatement has no field named condition
      P.node(isIfStatement, { condition: P.capture("test") })
      // @ts-expect-error text is a string
      P.node(isIdentifier, { text: 1 })
    }))

  effect(
    "shape checks its fields against the node type already in the pipe",
    () =>
      withProject({ "src/shapes.ts": SOURCE }, (project) =>
        Effect.gen(function* () {
          const found = yield* Query.calls(project).pipe(
            Query.within("src/shapes.ts"),
            Query.shape({ expression: P.capture("callee"), arguments: [P.capture("only")] }),
            Query.collect,
          )
          expectTypeOf(found[0]!.value.captures).toEqualTypeOf<{
            readonly callee: Expression
            readonly only: Expression
          }>()
          expect(found.map(({ value }) => value.captures.only.getText())).toEqual(["'a'", "'b'"])

          // @ts-expect-error CallExpression has no field named argumens
          Query.calls(project).pipe(Query.shape({ argumens: [P.capture("only")] }))
          // @ts-expect-error questionDotToken is a node, not a string
          Query.calls(project).pipe(Query.shape({ questionDotToken: "?." }))
        })),
  )

  effect(
    "match tags each node with the first pattern that fits and narrows its captures",
    () =>
      withProject({ "src/shapes.ts": SOURCE }, (project) =>
        Effect.gen(function* () {
          const found = yield* Query.match(project, { ifReturns, awaited }).pipe(
            Query.within("src/shapes.ts"),
            Query.collect,
          )
          expect(
            found.map(({ value }) =>
              value._tag === "ifReturns" ?
                `${value.captures.test.getText()} ? ${value.captures.whenTrue.getText()} : ${value.captures.whenFalse.getText()}` :
                `${value.captures.callee.text}(${value.captures.argument.text})`
            ),
          ).toEqual(['flag ? "yes" : "no"', "flag ? 1 : 2", "load(b)"])
        })),
  )

  effect(
    "typedCaptures gives every captured node its type so a rule can branch on it",
    () =>
      withProject({ "src/shapes.ts": SOURCE }, (project) =>
        Effect.gen(function* () {
          const found = yield* Query.match(project, { ifReturns }).pipe(
            Query.within("src/shapes.ts"),
            Query.typedCaptures,
            Query.collect,
          )
          const string = yield* project.intrinsicType("string")
          const stringly = yield* Effect.filter(found, ({ value }) =>
            value.types.whenTrue === undefined ?
              Effect.succeed(false) :
              project.isTypeAssignableTo(value.types.whenTrue, string))
          expect(stringly.map(({ value }) => value.captures.whenTrue.getText())).toEqual(['"yes"'])
          expect(found.every(({ value }) =>
            value.types.test !== undefined
          )).toBe(true)
        })),
  )
})
