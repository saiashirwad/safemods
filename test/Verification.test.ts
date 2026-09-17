import { describe, effect, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../src/Draft.ts"
import { finalizePlan, type TransformationPlan } from "../src/Plan.ts"
import type * as ProjectRelativePath from "../src/ProjectRelativePath.ts"
import * as Query from "../src/Query.ts"
import * as Recipe from "../src/Recipe.ts"
import { type DiagnosticRecord, diffDiagnostics } from "../src/Verification/Diagnostics.ts"
import * as Verification from "../src/Verification/index.ts"
import type { ConfiguredProject } from "../src/Workspace/index.ts"
import { projectPath } from "./utils/domain.ts"
import { fixtureProject, withFixture, write } from "./utils/fixture.ts"

const createFile = (
  name: string,
  app: ConfiguredProject.Type,
  content: string,
  policies: Parameters<typeof Recipe.define>[1]["policies"] = {},
) =>
  Recipe.define(name, {
    version: "1.0.0",
    policies,
    run: () =>
      Effect.map(fixtureProject(app), (project) =>
        Draft.createFile(project, projectPath("src/created.ts"), content),
      ),
  })

const diagnostic = (overrides: Partial<DiagnosticRecord>): DiagnosticRecord => ({
  code: 2304,
  message: "Cannot find name 'foo'",
  category: "error",
  fileName: "a.ts",
  start: 10,
  length: 3,
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
                  const swap = yield* project.file(projectPath("src/swap.ts"))
                  return Draft.concat(
                    Draft.deleteFile(swap!),
                    Draft.createFile(project, projectPath("src/other.ts"), "missingName;\n"),
                  )
                }),
            })
            const plan = yield* Recipe.run(recipe, undefined)
            const failure = yield* Effect.flip(Verification.verify(plan, recipe, undefined))
            expect(failure).toMatchObject({ _tag: "VerificationFailure", policy: "diagnostics" })
            expect(failure).toHaveProperty(
              "detail",
              expect.stringContaining("Introduced 1 new error diagnostic"),
            )
          }),
        { files: { "src/swap.ts": 'export const n: number = "text";\n' } },
      ),
    60_000,
  )

  effect(
    "no-new-errors fails on a syntax error and allow-new-errors accepts it",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const strict = createFile("strict", app, "export const broken = {\n")
          const failure = yield* Effect.flip(
            Verification.verify(yield* Recipe.run(strict, undefined), strict, undefined),
          )
          expect(failure).toMatchObject({ _tag: "VerificationFailure", policy: "diagnostics" })

          const lenient = createFile("lenient", app, "export const broken = {\n", {
            diagnostics: "allow-new-errors",
          })
          const verified = yield* Verification.verify(
            yield* Recipe.run(lenient, undefined),
            lenient,
            undefined,
          )
          expect(verified.diagnosticDiff.introduced.length).toBeGreaterThan(0)
        }),
      ),
    60_000,
  )

  effect(
    "enforces affected-file policies",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const commentImports = (name: string, policies: { readonly maxFiles?: number }) =>
            Recipe.define(name, {
              version: "1.0.0",
              policies:
                policies.maxFiles === undefined ? {} : { maxAffectedFiles: policies.maxFiles },
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  const imports = yield* Query.collect(Query.imports(project))
                  return Draft.concat(
                    ...imports.map(({ value }) =>
                      Draft.insertBefore(project, value, "/* seen */ "),
                    ),
                  )
                }),
            })

          const passing = commentImports("passing", {})
          yield* Verification.verify(yield* Recipe.run(passing, undefined), passing, undefined)

          const tooWide = commentImports("too-wide", { maxFiles: 1 })
          expect(
            yield* Effect.flip(
              Verification.verify(yield* Recipe.run(tooWide, undefined), tooWide, undefined),
            ),
          ).toMatchObject({ _tag: "VerificationFailure", policy: "affected-files" })
        }),
      ),
    60_000,
  )

  effect(
    "replays the recipe on the proposed workspace when idempotence is required",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const recipe = createFile("always-creates", app, "export {}\n", {
            idempotence: "required",
          })
          const plan = yield* Recipe.run(recipe, undefined)
          expect(yield* Effect.flip(Verification.verify(plan, recipe, undefined))).toMatchObject({
            _tag: "VerificationFailure",
            policy: "idempotence",
          })
        }),
      ),
    60_000,
  )

  effect(
    "rejects a recipe, input, or policy set other than the plan's author",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          const define = (name: string, version: string, policies = {}) =>
            Recipe.define(name, {
              version,
              policies,
              run: (_: { readonly value: number }) => Effect.succeed(Draft.empty),
            })
          const author = define("author", "1.0.0")
          const plan = yield* Recipe.run(author, { value: 1 })
          const mismatch = <E, R>(
            recipe: Recipe.Recipe<{ readonly value: number }, E, R>,
            value: number,
          ) => Effect.flip(Verification.verify(plan, recipe, { value }))

          expect(yield* mismatch(define("other", "1.0.0"), 1)).toMatchObject({ field: "name" })
          expect(yield* mismatch(define("author", "2.0.0"), 1)).toMatchObject({ field: "version" })
          expect(yield* mismatch(author, 2)).toMatchObject({ field: "input" })
          expect(
            yield* mismatch(define("author", "1.0.0", { idempotence: "required" }), 1),
          ).toMatchObject({ _tag: "PlanContextMismatch", field: "policies" })
        }),
      ),
    60_000,
  )

  effect(
    "rejects plans that are not canonical or not for this workspace's projects",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const recipe = createFile("create", app, "export {}\n")
          const plan = yield* Recipe.run(recipe, undefined)

          const dotted: TransformationPlan = {
            ...plan,
            sources: plan.sources.map((source) => ({
              ...source,
              fileName: `./${source.fileName}` as ProjectRelativePath.Type,
            })),
          }
          const { schemaVersion: _, planId: __, ...content } = plan
          const otherProject = yield* finalizePlan({
            ...content,
            projects: [{ id: app.id, configFileName: "other.json" }],
          })

          for (const [candidate, tag] of [
            [dotted, "InvalidPlan"],
            [otherProject, "PlanContextMismatch"],
          ] as const) {
            expect(
              yield* Effect.flip(Verification.verify(candidate, recipe, undefined)),
            ).toMatchObject({ _tag: tag })
            expect(yield* Effect.flip(Verification.preview(candidate))).toMatchObject({ _tag: tag })
          }
        }),
      ),
    60_000,
  )

  effect(
    "goes stale when any fingerprinted input changes, including tsconfig.json",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const recipe = createFile("create", app, "export {}\n")
          const plan = yield* Recipe.run(recipe, undefined)
          yield* write(root, "tsconfig.json", '{ "compilerOptions": { "strict": false } }\n')

          expect(yield* Effect.flip(Verification.verify(plan, recipe, undefined))).toMatchObject({
            _tag: "StalePlanError",
            fileName: "tsconfig.json",
          })
          expect(yield* Effect.flip(Verification.preview(plan))).toMatchObject({
            _tag: "StalePlanError",
          })
        }),
      ),
    60_000,
  )

  effect(
    "goes stale when a create or move target appears after planning",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const target = projectPath("src/raced.ts")
          const recipe = Recipe.define("move", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const library = yield* project.file(projectPath("src/library.ts"))
                return Draft.moveFile(library!, target)
              }),
          })
          const plan = yield* Recipe.run(recipe, undefined)
          yield* Verification.preview(plan)
          yield* write(root, target, "created by another process\n")
          expect(yield* Effect.flip(Verification.preview(plan))).toMatchObject({
            _tag: "StalePlanError",
            fileName: target,
          })
        }),
      ),
    60_000,
  )

  effect(
    "previews a moved file with the edits made to it",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const from = projectPath("src/library.ts")
          const to = projectPath("src/moved/library.ts")
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
          const plan = yield* Recipe.run(recipe, undefined)
          const preview = yield* Verification.preview(plan)
          expect(preview.files.map((file) => [file.fileName, file.after.exists])).toEqual([
            [from, false],
            [to, true],
          ])
          const moved = preview.files[1]!.after
          expect(moved.exists && moved.text.startsWith("// moved\n")).toBe(true)
        }),
      ),
    60_000,
  )

  effect(
    "issues a deeply frozen verified plan",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const recipe = createFile("create", app, "export {}\n")
          const verified = yield* Verification.verify(
            yield* Recipe.run(recipe, undefined),
            recipe,
            undefined,
          )
          expect(Object.isFrozen(verified)).toBe(true)
          expect(Object.isFrozen(verified.plan.projects[0])).toBe(true)
          expect(Object.isFrozen(verified.preview.files[0]?.after)).toBe(true)
        }),
      ),
    60_000,
  )
})
