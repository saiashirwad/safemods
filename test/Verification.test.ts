import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect, it } from "@effect/vitest"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { textEdit } from "../src/Edit.ts"
import * as Proposal from "../src/Proposal.ts"
import * as Query from "../src/Query.ts"
import * as Recipe from "../src/Recipe.ts"
import {
  collectDiagnostics,
  type DiagnosticRecord,
  diffDiagnostics,
} from "../src/Migration/Diagnostics.ts"
import * as Migration from "../src/Migration/index.ts"
import { layer as workspaceLayer, Workspace, WorkspaceDefinition } from "../src/Workspace/index.ts"
import { projectId, workspacePath } from "./utils/domain.ts"
import { exists, read, withFixture, write } from "./utils/fixture.ts"

const createFile = (
  name: string,
  content: string,
  policies: Parameters<typeof Recipe.define>[1]["policies"] = {},
) =>
  Recipe.define(name, {
    version: "1.0.0",
    policies,
    run: () => Effect.succeed(Proposal.createFile(workspacePath("src/created.ts"), content)),
  })

const diagnostic = (overrides: Partial<DiagnosticRecord>): DiagnosticRecord => ({
  projectId: projectId("app"),
  code: 2304,
  message: "Cannot find name 'foo'",
  category: "error",
  fileName: workspacePath("a.ts"),
  start: 10,
  end: 13,
  line: 1,
  column: 11,
  ...overrides,
})

describe("diagnostic diffs", () => {
  it("separates introduced, resolved, and unchanged diagnostics", () => {
    const kept = diagnostic({ code: 6133, category: "warning" })
    const fixed = diagnostic({ code: 2304 })
    const added = diagnostic({ code: 2322, fileName: workspacePath("b.ts") })
    expect(diffDiagnostics([fixed, kept], [kept, added])).toEqual({
      introduced: [added],
      resolved: [fixed],
      unchanged: [kept],
    })
  })

  it("treats diagnostics in moved files as unchanged", () => {
    const from = workspacePath("src/a.ts")
    const to = workspacePath("src/moved.ts")
    const before = diagnostic({ fileName: from })
    const after = diagnostic({ fileName: to })
    expect(diffDiagnostics([before], [after], new Map([[from, to]]))).toEqual({
      introduced: [],
      resolved: [],
      unchanged: [after],
    })
  })

  it("treats changed error text as a new diagnostic", () => {
    const before = diagnostic({ message: "Cannot find name 'before'" })
    const after = diagnostic({ message: "Cannot find name 'after'" })
    expect(diffDiagnostics([before], [after])).toEqual({
      introduced: [after],
      resolved: [before],
      unchanged: [],
    })
  })

  it("ignores position, but counts repeats and category changes", () => {
    const warning = diagnostic({ category: "warning" })
    const moved = { ...warning, start: 40 }
    const error = { ...warning, category: "error" as const }
    expect(diffDiagnostics([warning], [moved]).unchanged).toEqual([moved])
    expect(diffDiagnostics([warning], [warning, moved]).introduced).toEqual([moved])
    expect(diffDiagnostics([warning], [error])).toEqual({
      introduced: [error],
      resolved: [warning],
      unchanged: [],
    })
  })
})

describe("Migration.verify", () => {
  effect(
    "does not let an existing shared-file error mask a new error in another project",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const definition = yield* WorkspaceDefinition.make({
            projects: [
              { id: "strict", config: "tsconfig.json" },
              { id: "loose", config: "tsconfig.loose.json" },
            ],
          })
          const sourceText = yield* read(root, "tsconfig.loose.json")
          const recipe = Recipe.define("enable-strict-null-checks", {
            version: "1.0.0",
            run: () =>
              Effect.succeed({
                ...Proposal.empty,
                edits: [textEdit({
                  fileName: workspacePath("tsconfig.loose.json"),
                  sourceText,
                  start: 0,
                  end: sourceText.length,
                  newText: sourceText.replace("false", "true"),
                })],
              }),
          })
          const failure = yield* Effect.flip(Migration.verify(recipe, undefined)).pipe(
            Effect.provide(
              Layer.provideMerge(workspaceLayer(definition, root), NodeServices.layer),
            ),
          )
          expect(failure).toMatchObject({
            _tag: "VerificationFailure",
            policy: "diagnostics",
            diagnostics: [expect.objectContaining({ projectId: "loose", fileName: "shared.ts" })],
          })
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
          "shared.ts": "export const value: string = undefined\n",
        },
      }),
  )

  effect(
    "keeps identical diagnostics from distinct files outside the workspace",
    () =>
      withFixture((root) =>
        Effect.acquireUseRelease(
          Effect.promise(() => Fs.mkdtemp(Path.join(Path.dirname(root), "safemods-diagnostics-"))),
          (outside) =>
            Effect.gen(function* () {
              const paths = [Path.join(outside, "a.ts"), Path.join(outside, "b.ts")]
              yield* Effect.promise(() =>
                Promise.all(
                  paths.map((path) => Fs.writeFile(path, "export const value = missingName\n")),
                )
              )
              yield* write(
                root,
                "src/external.ts",
                paths.map((path) => `import ${JSON.stringify(path)}\n`).join(""),
              )
              const workspace = yield* Workspace
              const diagnostics = yield* workspace.withSnapshot(collectDiagnostics)
              expect(
                diagnostics.filter(({ code }) => code === 2304).map(({ fileName }) => fileName)
                  .sort((left, right) => (left ?? "").localeCompare(right ?? "")),
              ).toEqual(paths.map((path) => path.replaceAll("\\", "/")))
            }),
          (outside) => Effect.promise(() => Fs.rm(outside, { recursive: true, force: true })),
        )
      ),
  )

  effect(
    "does not charge identity edits against the affected-files budget",
    () =>
      withFixture((_root, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("identity", {
            version: "1.0.0",
            policies: { maxAffectedFiles: 0, idempotence: "required" },
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const file = (yield* project.file(workspacePath("src/library.ts")))!
                return Proposal.replaceText(file, file.sourceFile.text)
              }),
          })
          const migration = yield* Migration.verify(recipe, undefined)
          expect(migration.preview.files).toEqual([])
          expect(yield* migration.apply).toEqual({ written: [], removed: [] })
        })
      ),
  )
  effect(
    "rejects deleting the configured tsconfig while creating ill-typed source",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          const recipe = Recipe.define("delete-config-and-add-error", {
            version: "1.0.0",
            run: () =>
              Effect.succeed(Proposal.concat(
                {
                  ...Proposal.empty,
                  fileOperations: [{ kind: "delete", fileName: workspacePath("tsconfig.json") }],
                },
                Proposal.createFile(
                  workspacePath("src/created.ts"),
                  'export const value: number = "wrong"\n',
                ),
              )),
          })

          const exit = yield* Effect.exit(Migration.verify(recipe, undefined))
          expect(exit._tag).toBe("Failure")
        })
      ),
  )

  effect(
    "rejects replacing one error with another even when the total is unchanged",
    () =>
      withFixture(
        (_, app) =>
          Effect.gen(function* () {
            const recipe = Recipe.define("swap-one-error-for-another", {
              version: "1.0.0",
              run: (snapshot) =>
                Effect.gen(function* () {
                  const project = yield* snapshot.project(app.id)
                  const swap = yield* project.file(workspacePath("src/swap.ts"))
                  return Proposal.concat(
                    Proposal.deleteFile(swap!),
                    Proposal.createFile(workspacePath("src/other.ts"), "missingName;\n"),
                  )
                }),
            })
            const failure = yield* Effect.flip(Migration.verify(recipe, undefined))
            expect(failure).toMatchObject({ _tag: "VerificationFailure", policy: "diagnostics" })
            expect(failure).toHaveProperty(
              "detail",
              expect.stringContaining("Introduced 1 new error diagnostic"),
            )
          }),
        { files: { "src/swap.ts": 'export const n: number = "text";\n' } },
      ),
  )

  effect("rejects a new unresolved identifier at the same site", () =>
    withFixture(
      (_, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("rename-unresolved", {
            version: "1.0.0",
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const source = (yield* project.file(workspacePath("src/message.ts")))!.sourceFile
                return Proposal.replace(project, source.statements[0]!, "after")
              }),
          })

          const failure = yield* Effect.flip(Migration.verify(recipe, undefined))
          expect(failure).toMatchObject({
            _tag: "VerificationFailure",
            policy: "diagnostics",
            diagnostics: [expect.objectContaining({
              code: 2304,
              message: "Cannot find name 'after'.",
            })],
          })
        }),
      { files: { "src/message.ts": "before;\n" } },
    ))

  effect(
    "no-new-errors fails on a syntax error and allow-new-errors accepts it",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          const strict = createFile("strict", "export const broken = {\n")
          const failure = yield* Effect.flip(
            Migration.verify(strict, undefined),
          )
          expect(failure).toMatchObject({ _tag: "VerificationFailure", policy: "diagnostics" })

          const lenient = createFile("lenient", "export const broken = {\n", {
            diagnostics: "allow-new-errors",
          })
          const verified = yield* Migration.verify(lenient, undefined)
          expect(verified.diagnosticDiff.introduced.length).toBeGreaterThan(0)
        })
      ),
  )

  effect("enforces affected-file policies", () =>
    withFixture((_, app) =>
      Effect.gen(function* () {
        const commentImports = (name: string, policies: { readonly maxFiles?: number }) =>
          Recipe.define(name, {
            version: "1.0.0",
            policies: policies.maxFiles === undefined ?
              {} :
              { maxAffectedFiles: policies.maxFiles },
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const imports = yield* Query.imports(project)
                return Proposal.concat(
                  ...imports.map(({ value }) =>
                    Proposal.insertBefore(project, value, "/* seen */ ")
                  ),
                )
              }),
          })

        const passing = commentImports("passing", {})
        yield* Migration.verify(passing, undefined)

        const tooWide = commentImports("too-wide", { maxFiles: 1 })
        expect(
          yield* Effect.flip(
            Migration.verify(tooWide, undefined),
          ),
        ).toMatchObject({ _tag: "VerificationFailure", policy: "affected-files" })
      })
    ))

  effect(
    "replays the recipe on the proposed workspace when idempotence is required",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          const recipe = createFile("always-creates", "export {}\n", {
            idempotence: "required",
          })
          expect(yield* Effect.flip(Migration.verify(recipe, undefined))).toMatchObject({
            _tag: "VerificationFailure",
            policy: "idempotence",
          })
        })
      ),
  )

  effect(
    "rejects source membership changed while the recipe runs",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const external = workspacePath("src/external.ts")
          const recipe = Recipe.define("external-after-planning", {
            version: "1.0.0",
            policies: { idempotence: "required" },
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const file = yield* project.file(external)
                return file === undefined ?
                  yield* Effect.as(
                    write(root, external, "export const external = true\n"),
                    Proposal.empty,
                  ) :
                  Proposal.insertBefore(project, file.sourceFile.statements[0]!, "// second run\n")
              }),
          })
          expect(yield* Effect.flip(Migration.verify(recipe, undefined))).toMatchObject({
            _tag: "StaleMigrationError",
            path: "src",
          })
        })
      ),
  )

  effect(
    "idempotence counts deletion of a newly proposed empty file as a change",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const target = workspacePath("src/replayed-empty.ts")
          const recipe = Recipe.define("empty-file-toggle", {
            version: "1.0.0",
            policies: { idempotence: "required" },
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const file = yield* project.file(target)
                return file === undefined ?
                  Proposal.createFile(target, "") :
                  Proposal.deleteFile(file)
              }),
          })
          expect(yield* Effect.flip(Migration.verify(recipe, undefined))).toMatchObject({
            _tag: "VerificationFailure",
            policy: "idempotence",
            detail: "Second run proposed 1 change(s)",
          })
          expect(yield* exists(root, target)).toBe(false)
        })
      ),
  )

  effect(
    "previews a moved file with the edits made to it",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const from = workspacePath("src/library.ts")
          const to = workspacePath("src/moved/library.ts")
          const recipe = Recipe.define("move-and-edit", {
            version: "1.0.0",
            policies: { diagnostics: "allow-new-errors" },
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const library = (yield* project.file(from))!
                return Proposal.concat(
                  Proposal.moveFile(library, to),
                  Proposal.insertBefore(project, library.sourceFile.statements[0]!, "// moved\n"),
                )
              }),
          })
          const result = (yield* Migration.verify(recipe, undefined)).preview
          expect(result.files.map((file) => [file.fileName, file.after.exists])).toEqual([
            [from, false],
            [to, true],
          ])
          const moved = result.files[1]!.after
          expect(moved.exists && moved.text.startsWith("// moved\n")).toBe(true)
        })
      ),
  )

  effect("keeps a pre-existing diagnostic unchanged when its file is moved", () =>
    withFixture(
      (_, app) =>
        Effect.gen(function* () {
          const from = workspacePath("src/broken.ts")
          const to = workspacePath("src/moved/broken.ts")
          const recipe = Recipe.define("move-broken-file", {
            version: "1.0.0",
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                return Proposal.moveFile((yield* project.file(from))!, to)
              }),
          })

          const verified = yield* Migration.verify(recipe, undefined)
          expect(verified.diagnosticDiff.introduced).toEqual([])
          expect(verified.diagnosticDiff.resolved).toEqual([])
          expect(
            verified.diagnosticDiff.unchanged.some((diagnostic) =>
              diagnostic.fileName === "src/moved/broken.ts"
            ),
          ).toBe(true)
        }),
      { files: { "src/broken.ts": "missingName;\n" } },
    ))

  effect("rejects a move that exchanges one missing module for another", () =>
    withFixture(
      (_, app) =>
        Effect.gen(function* () {
          const from = workspacePath("src/a.ts")
          const to = workspacePath("src/nested/a.ts")
          const recipe = Recipe.define("move-with-new-error", {
            version: "1.0.0",
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                return Proposal.moveFile((yield* project.file(from))!, to)
              }),
          })
          const failure = yield* Effect.flip(Migration.verify(recipe, undefined))
          expect(failure).toMatchObject({
            _tag: "VerificationFailure",
            policy: "diagnostics",
            diagnostics: [expect.objectContaining({
              fileName: to,
              code: 2307,
              message: expect.stringContaining("./local.js"),
            })],
          })
        }),
      {
        fixture: "empty",
        files: {
          "tsconfig.json": JSON.stringify({
            compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext" },
            include: ["src/**/*.ts"],
          }),
          "src/a.ts":
            'import { local } from "./local.js"\nimport { outside } from "../outside.js"\nexport { local, outside }\n',
          "src/local.ts": "export const local = 1\n",
          "src/outside.ts": "export const outside = 2\n",
        },
      },
    ))

  effect("locates a tsconfig diagnostic in the config file", () =>
    withFixture(
      () =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          const diagnostics = yield* workspace.withSnapshot(collectDiagnostics)
          expect(
            diagnostics
              .filter(({ fileName }) => fileName?.endsWith("tsconfig.json") === true)
              .map(({ line, column }) => [line, column]),
          ).toEqual([[4, 5]])
        }),
      {
        fixture: "empty",
        files: {
          "tsconfig.json":
            '{\n  "compilerOptions": {\n    "strict": true,\n    "notAnOption": true\n  },\n  "include": ["src"]\n}\n',
          "src/a.ts": "export const a = 1\n",
        },
      },
    ))
})
