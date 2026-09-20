import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { Comparison, withComparison } from "../src/Comparison.ts"
import * as Query from "../src/Query.ts"
import {
  type ProjectFile,
  type ProjectSnapshot,
  Workspace,
  WorkspaceSnapshot,
} from "../src/Workspace/index.ts"
import { projectPath } from "./utils/domain.ts"
import { fixtureProject, withFixture } from "./utils/fixture.ts"

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ES2024",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    allowImportingTsExtensions: true,
    noEmit: true,
  },
  include: ["src/**/*.ts", "lib/**/*.ts"],
})

const SHARED = "export interface Shared {\n  readonly id: string\n}\n"

const A_BODY = [
  'import type { Shared } from "./shared.js"',
  'import { type Box, tag as jsTag } from "./b.js"',
  'import { tag as tsTag } from "./b.ts"',
  'import { tag as untouched } from "../lib/b.js"',
  'export { tag as reexported } from "./b.js"',
  "export const viaJs = jsTag",
  "export const viaTs = tsTag",
  "export const viaUnchanged = untouched",
  'export const lazy = async () => (await import("./b.js")).tag',
  'export const text = "./b.js"',
  "export declare const shared: Shared",
  "export declare const box: Box",
  "",
].join("\n")

const A_BEFORE = `${A_BODY}export { gone } from "./gone.js"\n`

const A_BEFORE_REWRITTEN = [
  'import type { Shared } from "./shared.js"',
  'import { type Box, tag as jsTag } from "./b.__before__.js"',
  'import { tag as tsTag } from "./b.__before__.ts"',
  'import { tag as untouched } from "../lib/b.js"',
  'export { tag as reexported } from "./b.__before__.js"',
  "export const viaJs = jsTag",
  "export const viaTs = tsTag",
  "export const viaUnchanged = untouched",
  'export const lazy = async () => (await import("./b.__before__.js")).tag',
  'export const text = "./b.js"',
  "export declare const shared: Shared",
  "export declare const box: Box",
  'export { gone } from "./gone.__before__.js"',
  "",
].join("\n")

const B_NOW = [
  'export const tag = "new" as const',
  "export interface Box {\n  readonly size: number\n  readonly label: string\n}",
  "export interface Knob {\n  readonly turn: string\n}",
  "",
].join("\n")

const B_BEFORE = [
  'export const tag = "old" as const',
  "export interface Box {\n  readonly size: number\n}",
  "export interface Knob {\n  readonly turn: number\n}",
  "",
].join("\n")

const FILES = {
  "tsconfig.json": TSCONFIG,
  "src/shared.ts": SHARED,
  "src/a.ts": A_BODY,
  "src/b.ts": B_NOW,
  "src/added.ts": "export const added = 1\n",
  "lib/b.ts": 'export const tag = "unchanged" as const\n',
}

const CURRENT_FILES = ["lib/b.ts", "src/a.ts", "src/added.ts", "src/b.ts", "src/shared.ts"]

const CHAIN_TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ES2024",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    resolveJsonModule: true,
    noEmit: true,
  },
  include: ["src/**/*"],
})

const CHAIN = [
  'import type { Wrap } from "../out/wrap.js"',
  'import type { Held } from "./held.js"',
  'import table from "./table.json" with { type: "json" }',
  "export declare const wrapped: Wrap",
  "export declare const held: Held",
  "export const size = table.size",
  "",
].join("\n")

const WRAP = 'import type { Leaf } from "./leaf.js"\nexport type Wrap = Leaf["size"]\n'

const LEAF = (size: string) => `export interface Leaf {\n  readonly size: ${size}\n}\n`

const HELD = (size: string) => `export type Held = ${size}\n`

const compared = <A, E, R>(
  use: (
    project: ProjectSnapshot,
    previous: (fileName: string) => ProjectFile | undefined,
  ) => Effect.Effect<A, E, R>,
) =>
  withFixture(
    (root, app) =>
      withComparison(
        new Map([
          [Path.join(root, "src/a.ts"), A_BEFORE],
          [Path.join(root, "src/b.ts"), B_BEFORE],
          [Path.join(root, "src/gone.ts"), "export const gone = 1\n"],
        ]),
        Effect.gen(function* () {
          const project = yield* fixtureProject(app)
          const { previous } = yield* Comparison
          return yield* use(project, (fileName) => previous.get(app.id)?.get(projectPath(fileName)))
        }),
      ),
    { fixture: "empty", files: FILES },
  )

const exportTypes = (file: ProjectFile) =>
  Effect.gen(function* () {
    const exported = yield* file.project.exportsOf(file)
    const entries = yield* Effect.forEach(exported, ({ name, symbol }) =>
      Effect.gen(function* () {
        const type = yield* file.project.typeOfSymbol(symbol)
        return [name, type === undefined ? undefined : yield* file.project.typeToString(type)]
      }),
    )
    return Object.fromEntries(entries)
  })

const exportedType = (file: ProjectFile, name: string, declared: boolean) =>
  Effect.gen(function* () {
    const exported = yield* file.project.exportsOf(file)
    const { symbol } = exported.find((entry) => entry.name === name)!
    return declared
      ? yield* file.project.declaredTypeOfSymbol(symbol)
      : (yield* file.project.typeOfSymbol(symbol))!
  })

const sortedNames = (selections: ReadonlyArray<Query.Selection<unknown>>) =>
  selections.map(({ fileName }) => fileName).sort()

describe("comparison", () => {
  effect("adds previous explicit roots without changing current files or inherited options", () =>
    withFixture(
      (root, app) =>
        withComparison(
          new Map([
            [Path.join(root, "src/api.ts"), "export const value: string | undefined = undefined\n"],
          ]),
          Effect.gen(function* () {
            const project = yield* fixtureProject(app)
            const previous = (yield* Comparison).previous
              .get(app.id)!
              .get(projectPath("src/api.ts"))!
            expect(yield* exportTypes(previous)).toEqual({ value: "string | undefined" })
            expect(yield* exportTypes((yield* project.file(projectPath("src/api.ts")))!)).toEqual({
              value: "1",
            })
            expect((yield* project.files).map((file) => file.fileName)).toEqual(["src/api.ts"])
            expect(yield* project.file(projectPath("src/api.__before__.ts"))).toBeUndefined()
          }),
        ),
      {
        fixture: "empty",
        files: {
          "base.json": '{ "compilerOptions": { "strict": true, "noEmit": true } }',
          "tsconfig.json":
            '{ // JSONC and inherited settings must survive\n "extends": "./base.json", "files": ["src/api.ts"], }',
          "src/api.ts": "export const value = 1\n",
          "src/excluded.ts": "export const excluded = true\n",
        },
      },
    ),
  )

  effect("keeps implicitly included current files while hiding previous siblings", () =>
    withFixture(
      (root, app) =>
        withComparison(
          new Map([[Path.join(root, "src/api.ts"), 'export const value = "old"\n']]),
          Effect.gen(function* () {
            const project = yield* fixtureProject(app)
            expect((yield* project.files).map((file) => file.fileName).sort()).toEqual([
              "src/api.ts",
              "src/other.ts",
            ])
            const previous = (yield* Comparison).previous
              .get(app.id)!
              .get(projectPath("src/api.ts"))!
            expect(yield* exportTypes(previous)).toEqual({ value: '"old"' })
            expect(yield* exportTypes((yield* project.file(projectPath("src/api.ts")))!)).toEqual({
              value: "1",
            })
          }),
        ),
      {
        fixture: "empty",
        files: {
          "tsconfig.json": '{ "compilerOptions": { "strict": true, "noEmit": true } }',
          "src/api.ts": "export const value = 1\n",
          "src/other.ts": "export const other = true\n",
        },
      },
    ),
  )

  effect("preserves project-reference source resolution when adding explicit roots", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          const current = Effect.gen(function* () {
            const project = yield* fixtureProject(app)
            return yield* exportTypes((yield* project.file(projectPath("src/api.ts")))!)
          })
          const workspace = yield* Workspace
          expect(yield* workspace.withSnapshot(current)).toEqual({ value: "string" })
          yield* withComparison(
            new Map([
              [
                Path.join(root, "src/api.ts"),
                'import type { Model } from "../dist/model/index.js"\nexport declare const value: Model["before"]\n',
              ],
            ]),
            Effect.gen(function* () {
              expect(yield* current).toEqual({ value: "string" })
              const previous = (yield* Comparison).previous
                .get(app.id)!
                .get(projectPath("src/api.ts"))!
              expect(yield* exportTypes(previous)).toEqual({ value: "number" })
            }),
          )
        }),
      {
        fixture: "empty",
        files: {
          "tsconfig.json": `{
            // references must remain on the configured project, not just its base
            "compilerOptions": { "strict": true, "noEmit": true },
            "files": ["src/api.ts"],
            "references": [{ "path": "./model" },],
          }`,
          "model/tsconfig.json": JSON.stringify({
            compilerOptions: { composite: true, rootDir: ".", outDir: "../dist/model" },
            files: ["index.ts"],
          }),
          "model/index.ts": "export interface Model { before: number; now: string }\n",
          "src/api.ts":
            'import type { Model } from "../dist/model/index.js"\nexport declare const value: Model["now"]\n',
        },
      },
    ),
  )

  effect("shares unchanged declarations and tells a changed interface apart", () =>
    compared((project, previous) =>
      Effect.gen(function* () {
        const a = (yield* project.file(projectPath("src/a.ts")))!
        const b = (yield* project.file(projectPath("src/b.ts")))!
        const assignable = (
          [now, before]: readonly [ProjectFile, ProjectFile],
          name: string,
          declared: boolean,
        ) =>
          Effect.gen(function* () {
            const current = yield* exportedType(now, name, declared)
            const earlier = yield* exportedType(before, name, declared)
            return {
              same: current === earlier,
              nowFitsBefore: yield* project.isTypeAssignableTo(current, earlier),
              beforeFitsNow: yield* project.isTypeAssignableTo(earlier, current),
            }
          })

        expect(yield* assignable([a, previous("src/a.ts")!], "shared", false)).toEqual({
          same: true,
          nowFitsBefore: true,
          beforeFitsNow: true,
        })
        expect(yield* assignable([a, previous("src/a.ts")!], "box", false)).toEqual({
          same: false,
          nowFitsBefore: true,
          beforeFitsNow: false,
        })
        expect(yield* assignable([b, previous("src/b.ts")!], "Box", true)).toEqual({
          same: false,
          nowFitsBefore: true,
          beforeFitsNow: false,
        })
        expect(yield* assignable([b, previous("src/b.ts")!], "Knob", true)).toEqual({
          same: false,
          nowFitsBefore: false,
          beforeFitsNow: false,
        })
      }),
    ),
  )

  effect("lets a previous file see the previous version of what it imports", () =>
    compared((project, previous) =>
      Effect.gen(function* () {
        const before = previous("src/a.ts")!
        expect(before.fileName).toBe("src/a.__before__.ts")
        expect(before.sourceFile.text).toBe(A_BEFORE_REWRITTEN)
        expect(yield* exportTypes(before)).toEqual({
          box: "Box",
          gone: "1",
          lazy: '() => Promise<"old">',
          reexported: '"old"',
          shared: "Shared",
          text: '"./b.js"',
          viaJs: '"old"',
          viaTs: '"old"',
          viaUnchanged: '"unchanged"',
        })
        expect(yield* exportTypes((yield* project.file(projectPath("src/a.ts")))!)).toEqual({
          box: "Box",
          lazy: '() => Promise<"new">',
          reexported: '"new"',
          shared: "Shared",
          text: '"./b.js"',
          viaJs: '"new"',
          viaTs: '"new"',
          viaUnchanged: '"unchanged"',
        })
      }),
    ),
  )

  effect("offers a deleted file as a previous file and gives an added file none", () =>
    withFixture(
      (root, app) =>
        withComparison(
          new Map([
            [Path.join(root, "src/b.ts"), B_BEFORE],
            [Path.join(root, "src/gone.ts"), "export const gone = 1\n"],
          ]),
          Effect.gen(function* () {
            const project = yield* fixtureProject(app)
            const previous = (yield* Comparison).previous.get(app.id)!
            expect([...previous.keys()].sort()).toEqual(["src/b.ts", "src/gone.ts"])
            expect(yield* project.file(projectPath("src/gone.ts"))).toBeUndefined()
            expect(yield* exportTypes(previous.get(projectPath("src/gone.ts"))!)).toEqual({
              gone: "1",
            })
          }),
        ),
      { fixture: "empty", files: FILES },
    ),
  )

  effect("hides previous files from files, queries, references and capture", () =>
    compared((project, previous) =>
      Effect.gen(function* () {
        expect((yield* project.files).map((file) => file.fileName).sort()).toEqual(CURRENT_FILES)
        expect((yield* project.textFiles).map((file) => file.fileName).sort()).toEqual(
          CURRENT_FILES,
        )
        expect(yield* project.file(projectPath("src/a.__before__.ts"))).toBeUndefined()
        expect(
          [...(yield* (yield* WorkspaceSnapshot).capture).get(project.project.id)!.keys()].sort(),
        ).toEqual([...CURRENT_FILES, "tsconfig.json"].sort())

        const named = yield* Query.identifiers(project).pipe(
          Query.filter(({ value }) => value.text === "Shared"),
          Query.collect,
        )
        expect(sortedNames(named)).toEqual(["src/a.ts", "src/a.ts", "src/shared.ts"])

        const declaration = named.find(({ fileName }) => fileName === "src/shared.ts")!
        expect(sortedNames(yield* Query.collect(Query.referencesTo(declaration)))).toEqual([
          "src/a.ts",
          "src/a.ts",
          "src/shared.ts",
        ])
        const [oldTag] = yield* project.exportsOf(previous("src/b.ts")!)
        expect(oldTag!.name).toBe("Box")
        expect(yield* project.declarationsOf(oldTag!.symbol)).toEqual([])
      }),
    ),
  )

  effect(
    "follows a chain of previous files out of the include globs, past a .d.ts and a json",
    () =>
      withFixture(
        (root, app) =>
          withComparison(
            new Map([
              [Path.join(root, "src/chain.ts"), CHAIN],
              [Path.join(root, "src/held.d.ts"), HELD("string")],
              [Path.join(root, "src/table.json"), '{ "size": "1" }\n'],
              [Path.join(root, "out/wrap.ts"), WRAP],
              [Path.join(root, "out/leaf.ts"), LEAF("string")],
            ]),
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              const previous = (yield* Comparison).previous.get(app.id)!
              expect([...previous.keys()].sort()).toEqual([
                "out/leaf.ts",
                "out/wrap.ts",
                "src/chain.ts",
                "src/held.d.ts",
                "src/table.json",
              ])
              expect(previous.get(projectPath("out/wrap.ts"))!.sourceFile.text).toBe(
                'import type { Leaf } from "./leaf.__before__.js"\nexport type Wrap = Leaf["size"]\n',
              )
              expect(previous.get(projectPath("src/chain.ts"))!.sourceFile.text).toBe(
                CHAIN.replace("../out/wrap.js", "../out/wrap.__before__.js")
                  .replace("./held.js", "./held.d.__before__.js")
                  .replace("./table.json", "./table.__before__.json"),
              )
              expect(yield* exportTypes(previous.get(projectPath("src/chain.ts"))!)).toEqual({
                held: "string",
                size: "string",
                wrapped: "string",
              })
              expect(
                yield* exportTypes((yield* project.file(projectPath("src/chain.ts")))!),
              ).toEqual({
                held: "number",
                size: "number",
                wrapped: "number",
              })
            }),
          ),
        {
          fixture: "empty",
          files: {
            "tsconfig.json": CHAIN_TSCONFIG,
            "src/chain.ts": CHAIN,
            "src/held.d.ts": HELD("number"),
            "src/table.json": '{ "size": 1 }\n',
            "out/wrap.ts": WRAP,
            "out/leaf.ts": LEAF("number"),
          },
        },
      ),
  )

  effect("leaves an ordinary snapshot and an empty comparison without previous files", () =>
    withFixture(
      (_, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          const plain = yield* workspace.withSnapshot(
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              return {
                files: (yield* project.files).map((file) => file.fileName).sort(),
                hidden: yield* project.hiddenFiles,
              }
            }),
          )
          expect(plain).toEqual({ files: CURRENT_FILES, hidden: [] })

          const empty = yield* withComparison(
            new Map(),
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              return {
                files: (yield* project.files).map((file) => file.fileName).sort(),
                previous: [...(yield* Comparison).previous],
              }
            }),
          )
          expect(empty).toEqual({ files: CURRENT_FILES, previous: [] })
        }),
      { fixture: "empty", files: FILES },
    ),
  )
})
