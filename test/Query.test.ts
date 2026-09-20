import { describe, effect, expect } from "@effect/vitest"
import { Effect, Predicate } from "effect"
import { and, refineKey } from "is-kit"
import { SyntaxKind, type Expression, type Node } from "typescript/unstable/ast"
import {
  isCallExpression,
  isFunctionDeclaration,
  isPropertySignatureDeclaration,
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
        })),
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
        })),
  )

  effect(
    "where keeps the selections whose effectful test holds",
    () =>
      withProject(
        { "src/tiny.ts": "export const alpha = 1\nexport const beta = 2\n" },
        (project) =>
          Effect.gen(function* () {
            const surviving = yield* Query.identifiers(project).pipe(
              Query.within("src/tiny.ts"),
              Query.where((selection) => Effect.succeed(selection.value.text === "alpha")),
              Query.collect,
            )
            expect(surviving.map((selection) => selection.value.text)).toEqual(["alpha"])
          }),
      ),
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
        })),
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
  )

  effect("resolvesTo follows a symbol across files", () =>
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
    ))

  effect(
    "resolvesTo canonicalizes a target symbol supplied through an import alias",
    () =>
      withProject(
        {
          "src/alias-library.ts": "export const oldThing = 1\n",
          "src/alias-consumer.ts": [
            'import { oldThing as localThing } from "./alias-library.js"',
            "export const result = localThing",
            "",
          ].join("\n"),
        },
        (project) =>
          Effect.gen(function* () {
            const consumer = yield* project.file(projectPath("src/alias-consumer.ts"))
            const localThing = (yield* Query.identifiers([consumer!]).pipe(
              Query.filter(({ value }) => value.text === "localThing"),
              Query.collect,
            ))[0]!
            const alias = yield* project.symbolOf(localThing.value)
            const references = yield* Query.identifiers(project).pipe(
              Query.where(Query.resolvesTo(alias!)),
              Query.collect,
            )
            expect(
              references.map((selection) => `${selection.fileName}:${selection.value.text}`),
            ).toEqual([
              "src/alias-consumer.ts:oldThing",
              "src/alias-consumer.ts:localThing",
              "src/alias-consumer.ts:localThing",
              "src/alias-library.ts:oldThing",
            ])
          }),
      ),
  )

  effect("finds every supported module reference form", () =>
    withProject(
      {
        "src/modules.ts": [
          'import type { Thing } from "./thing.js"',
          'export * from "./barrel.js"',
          'import legacy = require("./legacy.cjs")',
          'type Lazy = typeof import("./lazy.js")',
          'const dynamic = import("./dynamic.js")',
          'const common = require("./common.cjs")',
          "void [legacy, dynamic, common]",
          "export type { Thing, Lazy }",
          "",
        ].join("\n"),
        "src/thing.ts": "export interface Thing {}\n",
        "src/barrel.ts": "export {}\n",
        "src/legacy.cts": "export = {}\n",
        "src/lazy.ts": "export {}\n",
        "src/dynamic.ts": "export {}\n",
        "src/common.cts": "export = {}\n",
      },
      (project) =>
        Effect.gen(function* () {
          const references = yield* Query.moduleReferences(project).pipe(
            Query.within("src/modules.ts"),
            Query.collect,
          )
          expect(references.map(({ value }) => [value.kind, value.specifier.text])).toEqual([
            ["import", "./thing.js"],
            ["export", "./barrel.js"],
            ["import-equals", "./legacy.cjs"],
            ["import-type", "./lazy.js"],
            ["dynamic-import", "./dynamic.js"],
            ["require", "./common.cjs"],
          ])
        }),
    ))

  effect("classifies semantic references by their syntactic role", () =>
    withProject(
      {
        "src/roles.ts": [
          'import { oldThing as imported } from "./sem.js"',
          "export { imported as publicThing }",
          "type Alias = typeof imported",
          "let value = imported",
          "value = imported",
          "value++",
          "const object = { value, explicit: value }",
          "object.value",
          "",
        ].join("\n"),
        "src/sem.ts": "export const oldThing = 1\n",
      },
      (project) =>
        Effect.gen(function* () {
          const references = yield* Query.semanticReferences(project).pipe(
            Query.within("src/roles.ts"),
            Query.collect,
          )
          expect(references.map(({ value }) => `${value.node.text}:${value.role}`)).toEqual([
            "oldThing:import",
            "imported:import",
            "imported:export",
            "publicThing:export",
            "Alias:declaration",
            "imported:type",
            "value:declaration",
            "imported:read",
            "value:write",
            "imported:read",
            "value:write",
            "object:declaration",
            "value:shorthand",
            "explicit:property-name",
            "value:read",
            "object:read",
            "value:property-name",
          ])
        }),
    ))

  effect("resolves module references through the compiler", () =>
    withProject(
      {
        "src/module-user.ts": [
          'import { oldThing } from "./sem.js"',
          'export * from "./missing.js"',
          "void oldThing",
          "",
        ].join("\n"),
        "src/sem.ts": "export const oldThing = 1\n",
      },
      (project) =>
        Effect.gen(function* () {
          const references = yield* Query.resolvedModuleReferences(project).pipe(
            Query.within("src/module-user.ts"),
            Query.collect,
          )
          expect(
            references.map(({ value }) => [value.specifier.text, value.resolved?.fileName]),
          ).toEqual([
            ["./sem.js", "src/sem.ts"],
            ["./missing.js", undefined],
          ])
        }),
    ))

  const OVERLOAD_SOURCE = [
    "export function parse(value: string): string",
    "export function parse(value: number, radix: number): number",
    "export function parse(value: string | number, radix?: number): string | number {",
    '  return typeof value === "string" ? value : Number(value.toString(radix))',
    "}",
    "export const api = { parse }",
    "",
  ].join("\n")

  effect("describes the overload the checker selected for a call", () =>
    withProject(
      { "src/overload.ts": `${OVERLOAD_SOURCE}export const result = parse(10, 16)\n` },
      (project) =>
        Effect.gen(function* () {
          const [call] = yield* Query.calls(project).pipe(
            Query.within("src/overload.ts"),
            Query.filter(({ value }) => value.expression.getText() === "parse"),
            Query.collect,
          )
          const signature = yield* project.resolvedSignature(call!.value)
          const parameters = yield* project.parameterTypesOf(signature!)
          const returned = yield* project.returnTypeOf(signature!)
          expect(yield* Effect.forEach(parameters, (type) => project.typeToString(type!))).toEqual([
            "number",
            "number",
          ])
          expect(yield* project.typeToString(returned!)).toBe("number")
        }),
    ))

  effect(
    "resolvesToSignature matches calls by the overload they select, through any receiver",
    () =>
      withProject(
        {
          "src/overload.ts": OVERLOAD_SOURCE,
          "src/overload-consumer.ts": [
            'import { api, api as renamed, parse } from "./overload.js"',
            'parse("text")',
            "parse(10, 16)",
            "api.parse(11, 2)",
            "renamed.parse(12, 8)",
            'api.parse("other")',
            "const lookalike = { parse: (value: number, radix: number) => value + radix }",
            "lookalike.parse(1, 2)",
            "",
          ].join("\n"),
        },
        (project) =>
          Effect.gen(function* () {
            const overloads = yield* Query.nodes(project, isFunctionDeclaration).pipe(
              Query.within("src/overload.ts"),
              Query.filter(
                ({ value }) => value.body === undefined && value.parameters.length === 2,
              ),
              Query.collect,
            )
            expect(overloads).toHaveLength(1)
            const calls = yield* Query.calls(project).pipe(
              Query.where(Query.resolvesToSignature(overloads.map(({ value }) => value))),
              Query.collect,
            )
            expect(calls.map(({ value }) => value.getText())).toEqual([
              "parse(10, 16)",
              "api.parse(11, 2)",
              "renamed.parse(12, 8)",
            ])
          }),
      ),
  )

  effect("typeAssignableTo judges the node itself, not its first token", () =>
    withProject(
      {
        "src/typed.ts": [
          'const label = "abc" as string',
          "export const a = Number(label)",
          "export const b = label.toUpperCase()",
          'export const c = label.indexOf("b")',
          "",
        ].join("\n"),
      },
      (project) =>
        Effect.gen(function* () {
          const callsAssignableTo = (target: "number" | "string") =>
            Query.calls(project).pipe(
              Query.within("src/typed.ts"),
              Query.where(Query.typeAssignableTo(target)),
              Query.collect,
              Effect.map((calls) => calls.map(({ value }) => value.getText())),
            )
          expect(yield* callsAssignableTo("number")).toEqual([
            "Number(label)",
            'label.indexOf("b")',
          ])
          expect(yield* callsAssignableTo("string")).toEqual(["label.toUpperCase()"])
        }),
    ))

  effect("typed pairs each node with its checked type", () =>
    withProject(
      { "src/typed.ts": 'export const parsed = JSON.parse("1")\nexport const size = "x".length\n' },
      (project) =>
        Effect.gen(function* () {
          const calls = yield* Query.calls(project).pipe(
            Query.within("src/typed.ts"),
            Query.typed,
            Query.collect,
          )
          expect(
            yield* Effect.forEach(
              calls,
              ({ value }) =>
                Effect.map(
                  project.typeToString(value.type),
                  (type) => [value.node.getText(), type],
                ),
            ),
          ).toEqual([['JSON.parse("1")', "any"]])
        }),
    ))

  effect(
    "usesOf ignores default import bindings but retains actual escaping uses",
    () =>
      withProject(
        {
          "src/direct.ts": "export default function direct(value?: number) { return value ?? 1 }\n",
          "src/escaped.ts":
            "export default function escaped(value?: number) { return value ?? 1 }\n",
          "src/consumer.ts": [
            'import direct from "./direct.js"',
            'import escaped from "./escaped.js"',
            "direct()",
            "direct(2)",
            "escaped()",
            "export const callback = escaped",
            "",
          ].join("\n"),
        },
        (project) =>
          Effect.gen(function* () {
            for (const name of ["direct", "escaped"]) {
              const [selection] = yield* Query.namedFunctions(project).pipe(
                Query.within(`src/${name}.ts`),
                Query.collect,
              )
              const uses = yield* Query.usesOf({ ...selection!, value: selection!.value.name })
              expect(uses.calls.map(({ value }) => value.getText())).toEqual(
                name === "direct" ? ["direct()", "direct(2)"] : ["escaped()"],
              )
              expect(uses.escapes).toBe(name === "escaped")
            }
          }),
      ),
  )

  effect("referencesTo follows the checker, not the spelling", () =>
    withProject(
      {
        "src/account.ts": [
          "export interface Account { readonly displayName: string }",
          "/** See {@link Account.displayName}. */",
          'export const primary: Account = { displayName: "Ada" }',
          "",
        ].join("\n"),
        "src/account-consumer.ts": [
          'import { type Account, primary } from "./account.js"',
          "export const direct = primary.displayName",
          "export const destructured = ({ displayName }: Account) => displayName",
          "interface Other { displayName: string }",
          'export const other: Other = { displayName: "unrelated" }',
          'export const headers: Record<string, string> = { displayName: "unrelated" }',
          "export const read = headers.displayName",
          "",
        ].join("\n"),
      },
      (project) =>
        Effect.gen(function* () {
          const [declaration] = yield* Query.identifiers(project).pipe(
            Query.within("src/account.ts"),
            Query.filter(
              ({ value }) =>
                value.text === "displayName" && isPropertySignatureDeclaration(value.parent),
            ),
            Query.collect,
          )
          const references = yield* Query.referencesTo(declaration!).pipe(Query.collect)
          const lineOf = (selection: Query.Selection<Node>) =>
            selection.value.getSourceFile().text.slice(0, selection.start).split("\n").length
          expect(
            references.map((selection) => `${selection.fileName}:${lineOf(selection)}`),
          ).toEqual([
            "src/account-consumer.ts:2",
            "src/account-consumer.ts:3",
            "src/account.ts:1",
            "src/account.ts:2",
            "src/account.ts:3",
          ])
        }),
    ))
})
