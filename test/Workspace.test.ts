import { NodeServices } from "@effect/platform-node"
import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer, Option, Schema } from "effect"
import {
  WorkspaceCompilerError,
  type ModuleExport,
  SnapshotExpired,
  Workspace,
  WorkspaceDefinition,
  type WorkspaceSnapshot,
  layer as workspaceLayer,
} from "../src/Workspace/index.ts"
import { isObjectLiteralExpression } from "typescript/unstable/ast/is"
import * as Query from "../src/Query.ts"
import { InputSnapshot } from "../src/Workspace/InputSnapshot.ts"
import { workspacePath } from "./utils/domain.ts"
import { fixturePath, withFixture, withProject, write } from "./utils/fixture.ts"

const libraryPath = workspacePath("src/library.ts")

describe("workspace snapshots", () => {
  effect("rejects unsafe, empty, and duplicate project definitions", () =>
    Effect.gen(function* () {
      const app = { id: "app", config: "tsconfig.json" }
      for (
        const projects of [
          [],
          [{ id: "app", config: "../tsconfig.json" }],
          [{ id: "app", config: "/tmp/tsconfig.json" }],
          [{ id: "", config: "tsconfig.json" }],
          [{ id: "app\0other", config: "tsconfig.json" }],
          [app, { id: "app", config: "other.json" }],
          [app, { id: "other", config: "tsconfig.json" }],
        ]
      ) {
        const exit = yield* Effect.exit(
          Schema.decodeUnknownEffect(WorkspaceDefinition.schema)({ projects }),
        )
        expect({ projects, outcome: exit._tag }).toEqual({ projects, outcome: "Failure" })
      }
      const valid = yield* WorkspaceDefinition.make({ projects: [app] })
      expect(valid.projects).toEqual([app])
    }))

  effect(
    "names a file shared by two projects by one workspace path",
    () =>
      Effect.gen(function* () {
        const definition = yield* WorkspaceDefinition.make({
          projects: [
            { id: "root", config: "tsconfig.json" },
            { id: "nested", config: "nested/tsconfig.json" },
          ],
        })
        const shared = workspacePath("nested/src/shared.ts")
        const owners = yield* Workspace.use((workspace) =>
          workspace.withSnapshot(
            (snapshot) =>
              Effect.gen(function* () {
                expect((yield* snapshot.files(shared)).map((file) => file.fileName)).toEqual([
                  shared,
                  shared,
                ])
                const owners = yield* Effect.forEach(snapshot.projects, (project) =>
                  Effect.map(
                    project.files,
                    (files) =>
                      files.some((file) => file.fileName === shared) ? [project.project.id] : [],
                  ))
                return owners.flat()
              }),
          )
        ).pipe(
          Effect.provide(
            Layer.provideMerge(
              workspaceLayer(definition, fixturePath("multi-overlap")),
              NodeServices.layer,
            ),
          ),
        )
        expect(owners).toEqual(["root", "nested"])
      }),
  )

  effect(
    "exposes owned files by portable path",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const library = yield* project.file(libraryPath)
          expect(library?.sourceFile.text).toContain("function target")
          expect(Option.getOrUndefined(project.fileNameOf(library!.sourceFile))).toBe(libraryPath)
          expect((yield* project.files).map((file) => file.fileName)).toContain(libraryPath)
        })),
  )

  effect("includes source files discovered outside the config directory", () =>
    withFixture(
      (_, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          yield* workspace.withSnapshot(
            (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const outside = workspacePath("shared/outside.ts")
                const file = yield* project.file(outside)
                expect(file?.sourceFile.text).toContain("function outside")
                expect(Option.getOrUndefined(project.fileNameOf(file!.sourceFile))).toBe(outside)
                expect((yield* project.files).map((source) => source.fileName)).toContain(outside)
              }),
          )
        }),
      {
        fixture: "empty",
        files: {
          "tsconfig.json": JSON.stringify({
            compilerOptions: {
              strict: true,
              target: "ES2024",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              rootDir: "src",
              noEmit: true,
            },
            include: ["src/**/*.ts"],
          }),
          "src/main.ts": 'import { outside } from "../shared/outside.js"\noutside()\n',
          "shared/outside.ts": "export function outside(): void {}\n",
        },
      },
    ))

  effect(
    "fileNameOf returns None for an unrelated source file",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const library = yield* project.file(libraryPath)
          const unrelated = { ...library!.sourceFile, fileName: "/outside/project.ts" }
          expect(Option.isNone(project.fileNameOf(unrelated))).toBe(true)
        })),
  )

  effect(
    "every snapshot reads the current disk state",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          const libraryText = workspace.withSnapshot(
            (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                return (yield* project.file(libraryPath))?.sourceFile.text
              }),
          )
          expect(yield* libraryText).toContain("function target")
          yield* write(root, libraryPath, "export const rewritten = 1\n")
          expect(yield* libraryText).toBe("export const rewritten = 1\n")
        })
      ),
  )

  effect(
    "an overlay replaces, adds, and hides files without touching disk",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          const created = workspacePath("src/virtual-dir/created.ts")
          const overlay = {
            files: new Map([
              [Path.join(root, created), "export const created = 1\n"],
              [Path.join(root, libraryPath), "export const replaced = 1\n"],
            ]),
            deleted: new Set([Path.join(root, "src/barrel.ts")]),
          }
          yield* workspace.withSnapshot(
            (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                expect((yield* project.file(created))?.sourceFile.text).toBe(
                  "export const created = 1\n",
                )
                expect((yield* project.file(libraryPath))?.sourceFile.text).toBe(
                  "export const replaced = 1\n",
                )
                expect(yield* project.file(workspacePath("src/barrel.ts"))).toBeUndefined()
                const captured = yield* snapshot.capture
                expect(new TextDecoder().decode(captured.get(created))).toBe(
                  "export const created = 1\n",
                )
                expect(new TextDecoder().decode(captured.get(libraryPath))).toBe(
                  "export const replaced = 1\n",
                )
                expect(captured.has(workspacePath("src/barrel.ts"))).toBe(false)
              }),
            { overlay },
          )
        })
      ),
  )

  effect(
    "an overlay snapshot still sees files behind symlinked directories",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await Fs.mkdir(Path.join(root, "real"))
            await Fs.writeFile(Path.join(root, "real/linked.ts"), "export const linked = 1\n")
            await Fs.symlink(Path.join(root, "real"), Path.join(root, "src/link"), "dir")
          })
          const workspace = yield* Workspace
          const fileNames = (snapshot: WorkspaceSnapshot) =>
            Effect.gen(function* () {
              const project = yield* snapshot.project(app.id)
              return (yield* project.files).map((file) => file.fileName).sort()
            })
          const onDisk = yield* workspace.withSnapshot(fileNames)
          const overlaid = yield* workspace.withSnapshot(fileNames, {
            overlay: { files: new Map(), deleted: new Set() },
          })
          expect(onDisk).toContain("src/link/linked.ts")
          expect(overlaid).toEqual(onDisk)
        })
      ),
  )

  effect(
    "rejects a missing or overlaid-away configured project",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          const config = Path.join(root, "tsconfig.json")
          expect(
            yield* Effect.flip(workspace.withSnapshot(() => Effect.void, {
              overlay: { files: new Map(), deleted: new Set([config]) },
            })),
          ).toBeInstanceOf(WorkspaceCompilerError)
          yield* Effect.promise(() => Fs.unlink(config))
          expect(yield* Effect.flip(workspace.withSnapshot(() => Effect.void))).toBeInstanceOf(
            WorkspaceCompilerError,
          )
        })
      ),
  )

  effect(
    "shared inputs retain source discovery and raw BOM bytes",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          const inputs = new InputSnapshot()
          const text = "\uFEFFexport const original = 1\n"
          yield* write(root, libraryPath, text)
          const read = workspace.withSnapshot(
            (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                return {
                  names: (yield* project.files).map((file) => file.fileName),
                  text: (yield* project.file(libraryPath))?.sourceFile.text,
                  captured: yield* snapshot.capture,
                }
              }),
            { inputs },
          )
          const before = yield* read
          expect([...before.captured.get(libraryPath)!]).toEqual([
            ...new TextEncoder().encode(text),
          ])
          const copy = inputs.readBytes(Path.join(root, libraryPath))!
          copy.fill(0)
          yield* inputs.checkFresh
          yield* write(root, "src/new.ts", "export const added = 1\n")
          yield* write(root, libraryPath, "export const changed = 1\n")
          const after = yield* read
          expect(after.names).toEqual(before.names)
          expect(after.text).toBe(before.text)
          expect(after.captured.get(libraryPath)).toEqual(before.captured.get(libraryPath))
          const error = yield* Effect.flip(inputs.checkFresh)
          expect(Path.isAbsolute(error.path)).toBe(true)
        })
      ),
  )

  effect(
    "negative observations remain missing and detect creation",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const target = Path.join(root, "absent")
          for (
            const hook of [
              "readFile",
              "fileExists",
              "directoryExists",
              "getAccessibleEntries",
              "realpath",
            ] as const
          ) {
            const inputs = new InputSnapshot()
            const fs = inputs.fileSystem()
            const before = fs[hook]!(target)
            expect(before).not.toBeUndefined()
            yield* inputs.checkFresh
            yield* Effect.promise(async () => {
              if (hook === "directoryExists" || hook === "getAccessibleEntries") {
                await Fs.mkdir(target)
              } else await Fs.writeFile(target, "created")
            })
            expect(fs[hook]!(target)).toEqual(before)
            expect((yield* Effect.flip(inputs.checkFresh)).path).toBe(target)
            yield* Effect.promise(() => Fs.rm(target, { recursive: true }))
          }
        })
      ),
  )

  effect(
    "compiler observations detect new source membership",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          const inputs = new InputSnapshot()
          yield* workspace.withSnapshot(() => Effect.void, { inputs })
          yield* inputs.checkFresh
          yield* write(root, "src/discovered.ts", "export const discovered = 1\n")
          expect((yield* Effect.flip(inputs.checkFresh)).path).toBe(Path.join(root, "src"))
        })
      ),
  )

  effect(
    "compiler observations include configs outside the workspace root",
    () =>
      withFixture((root) => {
        const external = `${root}-base.json`
        return Effect.gen(function* () {
          yield* Effect.promise(() =>
            Fs.writeFile(external, JSON.stringify({ compilerOptions: { strict: true } }))
          )
          yield* write(
            root,
            "tsconfig.json",
            JSON.stringify({ extends: external, include: ["src/**/*.ts"] }),
          )
          const workspace = yield* Workspace
          const inputs = new InputSnapshot()
          yield* workspace.withSnapshot(() => Effect.void, { inputs })
          yield* inputs.checkFresh
          yield* Effect.promise(() =>
            Fs.writeFile(external, JSON.stringify({ compilerOptions: { strict: false } }))
          )
          expect((yield* Effect.flip(inputs.checkFresh)).path).toBe(external)
        }).pipe(Effect.ensuring(Effect.promise(() => Fs.rm(external, { force: true }))))
      }),
  )

  effect(
    "compiler observations detect extends and package metadata changes",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          for (const name of ["base.json", "package.json"]) {
            const inputs = new InputSnapshot()
            yield* workspace.withSnapshot(() => Effect.void, { inputs })
            yield* inputs.checkFresh
            yield* write(
              root,
              name,
              name === "base.json" ?
                JSON.stringify({ compilerOptions: { strict: false } }) :
                JSON.stringify({ type: "commonjs" }),
            )
            expect((yield* Effect.flip(inputs.checkFresh)).path).toBe(Path.join(root, name))
          }
        }), {
        fixture: "empty",
        files: {
          "tsconfig.json": JSON.stringify({
            extends: "./base.json",
            compilerOptions: { module: "NodeNext" },
            include: ["src/**/*.ts"],
          }),
          "base.json": JSON.stringify({ compilerOptions: { strict: true } }),
          "package.json": JSON.stringify({ type: "module" }),
          "src/main.ts": "export const main = 1\n",
        },
      }),
  )

  effect(
    "symbolNamed resolves aliases and re-exports to one canonical symbol",
    () =>
      withProject({}, (project) =>
        Effect.gen(function* () {
          const named = (name: string, within: string) =>
            project.symbolNamed(name, { within: workspacePath(within) })
          const original = yield* named("target", "src/library.ts")
          expect(yield* named("renamed", "src/consumer.ts")).toBe(original)
          expect(yield* named("publicTarget", "src/barrel.ts")).toBe(original)
          expect(yield* named("publicTarget", "src/reexport-consumer.ts")).toBe(original)

          const missing = yield* Effect.flip(named("absent", "src/library.ts"))
          expect(missing._tag).toBe("SymbolNotFound")
        })),
  )

  effect(
    "exportsOf resolves re-exports, star exports and default to canonical symbols",
    () =>
      withProject(
        {
          "src/origin.ts": [
            'export interface Shape { readonly tag: "shape" }',
            "export const build = (): Shape => ({ tag: 'shape' })",
            "",
          ].join("\n"),
          "src/star.ts": "export const extra = 2\n",
          "src/facade.ts": [
            'export { build as make } from "./origin.js"',
            'export type { Shape } from "./origin.js"',
            'export * from "./star.js"',
            "export default function entry(): number {",
            "  return 1",
            "}",
            "",
          ].join("\n"),
          "src/impostor.ts": "export const make = 3\n",
        },
        (project) =>
          Effect.gen(function* () {
            const exportsIn = (fileName: string) =>
              Effect.gen(function* () {
                const file = yield* project.file(workspacePath(fileName))
                return yield* project.exportsOf(file!)
              })
            const symbolOf = (exported: ReadonlyArray<ModuleExport>, name: string) =>
              exported.find((entry) => entry.name === name)?.symbol

            const facade = yield* exportsIn("src/facade.ts")
            const origin = yield* exportsIn("src/origin.ts")
            const impostor = yield* exportsIn("src/impostor.ts")

            expect(facade.map((entry) => entry.name)).toEqual(["Shape", "default", "extra", "make"])
            expect(symbolOf(facade, "make")).toBe(symbolOf(origin, "build"))
            expect(symbolOf(facade, "Shape")).toBe(symbolOf(origin, "Shape"))
            expect(symbolOf(facade, "make")).not.toBe(symbolOf(impostor, "make"))
            expect(symbolOf(facade, "default")).toBe(
              yield* project.symbolNamed("entry", { within: workspacePath("src/facade.ts") }),
            )
            expect(yield* project.declaredIn(symbolOf(facade, "extra")!)).toEqual([
              { path: expect.stringContaining("src/star.ts"), fileName: "src/star.ts" },
            ])
          }),
      ),
  )

  effect(
    "answers what an expression is expected to be and where a symbol is declared",
    () =>
      withProject(
        {
          "src/expected.ts": [
            "interface Row { readonly id: string; readonly label: string }",
            "const save = (row: Row): string => row.id",
            'export const saved = save({ id: "1", label: "first" })',
            "export const parsed = JSON.parse",
            "",
          ].join("\n"),
        },
        (project) =>
          Effect.gen(function* () {
            const [literal] = yield* Query.nodes(project, isObjectLiteralExpression).pipe(
              Query.within("src/expected.ts"),
            )
            const expected = yield* project.contextualTypeOf(literal!.value)
            expect(yield* project.typeToString(expected!)).toBe("Row")
            expect((yield* project.propertiesOf(expected!)).map((property) => property.name))
              .toEqual(
                ["id", "label"],
              )

            const declaredIn = (name: string) =>
              Effect.gen(function* () {
                const uses = yield* Query.identifiers(project).pipe(
                  Query.within("src/expected.ts"),
                  Query.filter(({ value }) => value.text === name),
                )
                const symbol = yield* project.symbolOf(uses.at(-1)!.value)
                const declarations = yield* project.declarationsOf(symbol!)
                return declarations.map((declaration) =>
                  Option.getOrUndefined(project.fileNameOf(declaration.getSourceFile()))
                )
              })
            expect(yield* declaredIn("save")).toEqual(["src/expected.ts"])
            expect(yield* declaredIn("JSON")).toEqual([])
          }),
      ),
  )

  effect(
    "fails with SnapshotExpired when a project snapshot outlives its region",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          const escaped = yield* workspace.withSnapshot((snapshot) => snapshot.project(app.id))
          expect(yield* Effect.flip(escaped.files)).toBeInstanceOf(SnapshotExpired)
          expect(
            yield* Effect.flip(escaped.symbolNamed("target", { within: libraryPath })),
          ).toBeInstanceOf(SnapshotExpired)
        })
      ),
  )
})
