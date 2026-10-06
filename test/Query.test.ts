import { describe, effect, expect } from "@effect/vitest"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, Option, Predicate } from "effect"
import { and, refineKey } from "is-kit"
import { SyntaxKind, type Expression, type Node } from "typescript/unstable/ast"
import {
  isCallExpression,
  isFunctionDeclaration,
  isPropertySignatureDeclaration,
} from "typescript/unstable/ast/is"
import { vi } from "vitest"
import * as Query from "../src/Query.ts"
import { workspacePath } from "./utils/domain.ts"
import { withFixture, withProject } from "./utils/fixture.ts"
import * as Proposal from "../src/Proposal.ts"
import { layer as workspaceLayer, Workspace, WorkspaceDefinition } from "../src/Workspace/index.ts"

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
    "semantic queries retain multi-node native batches grouped by source file",
    () =>
      withProject({
        "src/batch-a.ts": "export const first = 1; export const second = 2\n",
        "src/batch-b.ts": "export const third = 3; export const fourth = 4\n",
      }, (project) =>
        Effect.gen(function* () {
          const spy = yield* project.unsafeNative((native) =>
            Effect.sync(() => vi.spyOn(native.checker, "getTypeAtLocation"))
          )
          yield* Effect.gen(function* () {
            const typed = yield* Query.identifiers(project).pipe(
              Query.within("src/batch-*.ts"),
              Query.typed,
            )
            expect(typed).toHaveLength(4)
            expect(
              spy.mock.calls.map(([nodes]) => nodes.length).sort((left, right) => left - right),
            ).toEqual([2, 2])
            for (const [nodes] of spy.mock.calls) {
              expect(new Set(nodes.map((node) => node.getSourceFile())).size).toBe(1)
            }
          }).pipe(Effect.ensuring(Effect.sync(() => spy.mockRestore())))
        })),
  )

  effect(
    "shared file scopes preserve both compiler contexts regardless of input order",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const definition = yield* WorkspaceDefinition.make({
            projects: [
              { id: "strict", config: "tsconfig.json" },
              { id: "loose", config: "tsconfig.loose.json" },
            ],
          })
          yield* Workspace.use((workspace) =>
            workspace.withSnapshot(
              (snapshot) =>
                Effect.gen(function* () {
                  const files = yield* Effect.forEach(
                    snapshot.projects,
                    (project) => project.file(workspacePath("shared.ts")),
                  )
                  for (const ordered of [files, [...files].reverse()]) {
                    const selections = yield* Query.identifiers([
                      ordered[0]!,
                      ordered[1]!,
                      ordered[0]!,
                    ]).pipe(Query.typed)
                    const results = yield* Effect.forEach(selections, ({ project, value }) =>
                      Effect.map(
                        project.typeToString(value.type),
                        (type) => [project.project.id, type],
                      ))
                    expect(results).toEqual([["loose", "string"], ["strict", "string | undefined"]])
                  }
                }),
            )
          ).pipe(
            Effect.provide(
              Layer.provideMerge(workspaceLayer(definition, root), NodeServices.layer),
            ),
          )
        }), {
        fixture: "empty",
        files: {
          "tsconfig.json": JSON.stringify({
            compilerOptions: { strictNullChecks: true },
            files: ["shared.ts"],
          }),
          "tsconfig.loose.json": JSON.stringify({
            compilerOptions: { strictNullChecks: false },
            files: ["shared.ts"],
          }),
          "shared.ts": "export let value: string | undefined\n",
        },
      }),
  )

  effect(
    "stale syntax cannot claim ownership in a later snapshot",
    () =>
      withFixture((_, app) =>
        Workspace.use((workspace) =>
          Effect.gen(function* () {
            const stale = yield* workspace.withSnapshot((snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const file = yield* project.file(workspacePath("src/library.ts"))
                return { project, file: file! }
              })
            )
            expect(Option.isSome(Query.selectionOf(stale.project, stale.file.sourceFile))).toBe(
              true,
            )
            expect((yield* Effect.exit(stale.project.typeOf(stale.file.sourceFile)))._tag).toBe(
              "Failure",
            )
            yield* workspace.withSnapshot((snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const current = yield* project.file(stale.file.fileName)
                expect(Option.isSome(Query.selectionOf(project, current!.sourceFile))).toBe(true)
                expect(Option.isNone(project.fileNameOf(stale.file.sourceFile))).toBe(true)
                expect(Option.isNone(Query.selectionOf(project, stale.file.sourceFile))).toBe(true)
                expect(() => Proposal.replace(project, stale.file.sourceFile, "")).toThrow(
                  "Node is not in project",
                )
                expect(yield* Effect.result(Query.identifiers([{ ...stale.file, project }])))
                  .toMatchObject({ _tag: "Failure", failure: { _tag: "NodeNotOwned" } })
                const spy = yield* project.unsafeNative((native) =>
                  Effect.sync(() => vi.spyOn(native.checker, "getTypeAtLocation"))
                )
                yield* Effect.gen(function* () {
                  const results = yield* Effect.forEach(
                    [current!.sourceFile, stale.file.sourceFile],
                    (node) => Effect.result(project.typeOf(node)),
                    { concurrency: "unbounded" },
                  )
                  expect(results[0]!._tag).toBe("Success")
                  expect(results[1]).toMatchObject({
                    _tag: "Failure",
                    failure: { _tag: "NodeNotOwned" },
                  })
                  expect(spy).toHaveBeenCalledTimes(1)
                  expect(spy.mock.calls[0]![0]).toEqual([current!.sourceFile])
                }).pipe(Effect.ensuring(Effect.sync(() => spy.mockRestore())))
              })
            )
          })
        )
      ),
  )

  effect(
    "signature queries reject declarations from another project or an expired snapshot",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const definition = yield* WorkspaceDefinition.make({
            projects: [
              { id: "first", config: "tsconfig.json" },
              { id: "second", config: "tsconfig.second.json" },
            ],
          })
          yield* Workspace.use((workspace) =>
            Effect.gen(function* () {
              const declarations = yield* workspace.withSnapshot((snapshot) =>
                Effect.gen(function* () {
                  const [first, second] = snapshot.projects
                  const declarations = yield* Query.nodes(first!, isFunctionDeclaration)
                  expect(
                    yield* Query.calls(first!).pipe(
                      Query.where(Query.resolvesToSignature(declarations)),
                    ),
                  ).toHaveLength(1)
                  expect(
                    yield* Effect.result(
                      Query.calls(second!).pipe(
                        Query.where(Query.resolvesToSignature(declarations)),
                      ),
                    ),
                  ).toMatchObject({ _tag: "Failure", failure: { _tag: "NodeNotOwned" } })
                  return declarations
                })
              )
              yield* workspace.withSnapshot((snapshot) =>
                Effect.gen(function* () {
                  expect(
                    yield* Effect.result(
                      Query.calls(snapshot.projects[0]!).pipe(
                        Query.where(Query.resolvesToSignature(declarations)),
                      ),
                    ),
                  ).toMatchObject({ _tag: "Failure", failure: { _tag: "NodeNotOwned" } })
                })
              )
            })
          ).pipe(
            Effect.provide(
              Layer.provideMerge(workspaceLayer(definition, root), NodeServices.layer),
            ),
          )
        }), {
        fixture: "empty",
        files: {
          "tsconfig.json": JSON.stringify({ files: ["shared.ts"] }),
          "tsconfig.second.json": JSON.stringify({ files: ["shared.ts"] }),
          "shared.ts": "export function chosen(value: number) { return value }\nchosen(1)\n",
        },
      }),
  )

  effect(
    "external library syntax under the workspace root is not an owned edit location",
    () =>
      withProject({
        "src/external.ts": 'import { external } from "external"\nexport const value = external\n',
        "node_modules/external/package.json": JSON.stringify({
          name: "external",
          types: "index.d.ts",
        }),
        "node_modules/external/index.d.ts": "export declare const external: string\n",
      }, (project) =>
        Effect.gen(function* () {
          const external = yield* project.unsafeNative((native) =>
            Effect.promise(async () => {
              const names = await native.program.getSourceFileNames()
              return native.program.getSourceFile(
                names.find((name) => name.endsWith("/external/index.d.ts"))!,
              )
            })
          )
          expect(external).toBeDefined()
          expect(yield* project.file(workspacePath("node_modules/external/index.d.ts")))
            .toBeUndefined()
          expect(Option.isNone(project.fileNameOf(external!))).toBe(true)
          expect(Option.isNone(Query.selectionOf(project, external!))).toBe(true)
          expect(() => Proposal.replace(project, external!, "")).toThrow("Node is not in project")
          expect(yield* Effect.result(project.typeOf(external!))).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "NodeNotOwned" },
          })
          expect(
            yield* Effect.result(Query.identifiers([{
              project,
              fileName: workspacePath("node_modules/external/index.d.ts"),
              sourceFile: external!,
            }])),
          ).toMatchObject({ _tag: "Failure", failure: { _tag: "NodeNotOwned" } })
        })),
  )

  effect(
    "sources stay on project-owned files",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const files = yield* project.files
          const owned = new Set(files.map((file) => file.fileName))
          const fromProject = yield* Query.identifiers(project)
          const fromFiles = yield* Query.identifiers(files)

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
          const library = yield* project.file(workspacePath("src/library.ts"))
          const consumer = yield* project.file(workspacePath("src/consumer.ts"))
          const consumerAgain = yield* project.file(workspacePath("src/consumer.ts"))
          expect(yield* project.file(workspacePath("src/absent.ts"))).toBeUndefined()

          const exported = yield* Query.nodes([library!, consumer!], isFunctionDeclaration).pipe(
            Query.filter(
              ({ value }) =>
                value.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ??
                  false,
            ),
          )
          expect(exported.map((selection) => selection.fileName)).toEqual([
            "src/library.ts",
            "src/library.ts",
          ])

          const once = yield* Query.calls([consumer!])
          const twice = yield* Query.calls([consumer!, consumerAgain!])
          expect(twice.length).toBe(once.length)
          expect(yield* Query.calls([])).toEqual([])
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
            within: workspacePath("src/sem.ts"),
          })
          const references = yield* Query.identifiers(project).pipe(
            Query.where(Query.resolvesTo(symbol)),
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
            const consumer = yield* project.file(workspacePath("src/alias-consumer.ts"))
            const localThing = (yield* Query.identifiers([consumer!]).pipe(
              Query.filter(({ value }) => value.text === "localThing"),
            ))[0]!
            const alias = yield* project.symbolOf(localThing.value)
            const references = yield* Query.identifiers(project).pipe(
              Query.where(Query.resolvesTo(alias!)),
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
            )
            expect(overloads).toHaveLength(1)
            const calls = yield* Query.calls(project).pipe(
              Query.where(Query.resolvesToSignature(overloads)),
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
          )
          const references = yield* Query.referencesTo(declaration!)
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
