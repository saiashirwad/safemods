import { describe, effect, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../src/Draft.ts"
import * as Query from "../src/Query.ts"
import * as Recipe from "../src/Recipe.ts"
import {
  collectDiagnostics,
  type DiagnosticRecord,
  diffDiagnostics,
} from "../src/Verification/Diagnostics.ts"
import * as Verification from "../src/Verification/index.ts"
import { Workspace } from "../src/Workspace/index.ts"
import { workspacePath } from "./utils/domain.ts"
import { fixtureProject, withFixture, write } from "./utils/fixture.ts"

const createFile = (
  name: string,
  content: string,
  policies: Parameters<typeof Recipe.define>[1]["policies"] = {},
) =>
  Recipe.define(name, {
    version: "1.0.0",
    policies,
    run: () => Effect.succeed(Draft.createFile(workspacePath("src/created.ts"), content)),
  })

const diagnostic = (overrides: Partial<DiagnosticRecord>): DiagnosticRecord => ({
  code: 2304,
  message: "Cannot find name 'foo'",
  category: "error",
  fileName: "a.ts",
  start: 10,
  length: 3,
  line: 1,
  column: 11,
  ...overrides,
})

describe("diagnostic diffs", () => {
  it("separates introduced, resolved, and unchanged diagnostics", () => {
    const kept = diagnostic({ code: 6133, category: "warning" })
    const fixed = diagnostic({ code: 2304 })
    const added = diagnostic({ code: 2322, fileName: "b.ts" })
    expect(diffDiagnostics([fixed, kept], [kept, added])).toEqual({
      introduced: [added],
      resolved: [fixed],
      unchanged: [kept],
    })
  })

  it("treats diagnostics in moved files as unchanged", () => {
    const before = diagnostic({ fileName: "/workspace/src/a.ts" })
    const after = diagnostic({ fileName: "/workspace/src/moved.ts" })
    expect(
      diffDiagnostics(
        [before],
        [after],
        new Map([["/workspace/src/a.ts", "/workspace/src/moved.ts"]]),
      ),
    ).toEqual({ introduced: [], resolved: [], unchanged: [after] })
  })

  it("treats changed error text as the same diagnostic kind", () => {
    const before = diagnostic({ message: "Cannot find name 'before'" })
    const after = diagnostic({ message: "Cannot find name 'after'" })
    expect(diffDiagnostics([before], [after])).toEqual({
      introduced: [],
      resolved: [],
      unchanged: [after],
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

describe("Verification.verify", () => {
  effect(
    "rejects replacing one error with another even when the total is unchanged",
    () =>
      withFixture(
        (_, app) =>
          Effect.gen(function* () {
            const recipe = Recipe.define("swap-one-error-for-another", {
              version: "1.0.0",
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  const swap = yield* project.file(workspacePath("src/swap.ts"))
                  return Draft.concat(
                    Draft.deleteFile(swap!),
                    Draft.createFile(workspacePath("src/other.ts"), "missingName;\n"),
                  )
                }),
            })
            const failure = yield* Effect.flip(Verification.verify(recipe, undefined))
            expect(failure).toMatchObject({ _tag: "VerificationFailure", policy: "diagnostics" })
            expect(failure).toHaveProperty(
              "detail",
              expect.stringContaining("Introduced 1 new error diagnostic"),
            )
          }),
        { files: { "src/swap.ts": 'export const n: number = "text";\n' } },
      ),
  )

  effect("accepts a renamed unresolved identifier at the same site", () =>
    withFixture(
      (_, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("rename-unresolved", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const source = (yield* project.file(workspacePath("src/message.ts")))!.sourceFile
                return Draft.replace(project, source.statements[0]!, "after")
              }),
          })

          const verified = yield* Verification.verify(recipe, undefined)
          expect(verified.diagnosticDiff.introduced).toEqual([])
          expect(verified.diagnosticDiff.resolved).toEqual([])
          expect(verified.diagnosticDiff.unchanged).toEqual([
            expect.objectContaining({ code: 2304, message: "Cannot find name 'after'." }),
          ])
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
            Verification.verify(strict, undefined),
          )
          expect(failure).toMatchObject({ _tag: "VerificationFailure", policy: "diagnostics" })

          const lenient = createFile("lenient", "export const broken = {\n", {
            diagnostics: "allow-new-errors",
          })
          const verified = yield* Verification.verify(lenient, undefined)
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
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const imports = yield* Query.collect(Query.imports(project))
                return Draft.concat(
                  ...imports.map(({ value }) => Draft.insertBefore(project, value, "/* seen */ ")),
                )
              }),
          })

        const passing = commentImports("passing", {})
        yield* Verification.verify(passing, undefined)

        const tooWide = commentImports("too-wide", { maxFiles: 1 })
        expect(
          yield* Effect.flip(
            Verification.verify(tooWide, undefined),
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
          expect(yield* Effect.flip(Verification.verify(recipe, undefined))).toMatchObject({
            _tag: "VerificationFailure",
            policy: "idempotence",
          })
        })
      ),
  )

  effect(
    "rejects replay changes to files that appeared after the first run",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const external = workspacePath("src/external.ts")
          const recipe = Recipe.define("external-after-planning", {
            version: "1.0.0",
            policies: { idempotence: "required" },
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const file = yield* project.file(external)
                return file === undefined ?
                  yield* Effect.as(
                    write(root, external, "export const external = true\n"),
                    Draft.empty,
                  ) :
                  Draft.insertBefore(project, file.sourceFile.statements[0]!, "// second run\n")
              }),
          })
          expect(yield* Effect.flip(Verification.verify(recipe, undefined))).toMatchObject({
            _tag: "VerificationFailure",
            policy: "idempotence",
            detail: "Second run proposed 1 change(s)",
          })
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
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const library = (yield* project.file(from))!
                return Draft.concat(
                  Draft.moveFile(library, to),
                  Draft.insertBefore(project, library.sourceFile.statements[0]!, "// moved\n"),
                )
              }),
          })
          const result = (yield* Verification.verify(recipe, undefined)).preview
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
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                return Draft.moveFile((yield* project.file(from))!, to)
              }),
          })

          const verified = yield* Verification.verify(recipe, undefined)
          expect(verified.diagnosticDiff.introduced).toEqual([])
          expect(verified.diagnosticDiff.resolved).toEqual([])
          expect(
            verified.diagnosticDiff.unchanged.some((diagnostic) =>
              diagnostic.fileName?.endsWith("/moved/broken.ts")
            ),
          ).toBe(true)
        }),
      { files: { "src/broken.ts": "missingName;\n" } },
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
