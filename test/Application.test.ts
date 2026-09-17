import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Application from "../src/Application.ts"
import * as Draft from "../src/Draft.ts"
import * as Query from "../src/Query.ts"
import * as Recipe from "../src/Recipe.ts"
import * as Verification from "../src/Verification/index.ts"
import type { ConfiguredProject } from "../src/Workspace/index.ts"
import { projectPath } from "./utils/domain.ts"
import { executeRecipe } from "./utils/execute-recipe.ts"
import { exists, fixtureProject, read, withFixture, write } from "./utils/fixture.ts"

const createFile = (app: ConfiguredProject.Type, fileName: string, content: string) =>
  Recipe.define(`create-${fileName}`, {
    version: "1.0.0",
    policies: { diagnostics: "allow-new-errors" },
    run: () =>
      Effect.map(fixtureProject(app), (project) =>
        Draft.createFile(project, projectPath(fileName), content),
      ),
  })

const verified = <E, R>(recipe: Recipe.Recipe<undefined, E, R>) =>
  Effect.flatMap(Recipe.run(recipe, undefined), (plan) =>
    Verification.verify(plan, recipe, undefined),
  )

describe("Application.applyVerifiedPlan", () => {
  effect(
    "creates, moves, edits, and deletes files in one plan, including empty ones",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const recipe = Recipe.define("file-lifecycle", {
              version: "1.0.0",
              policies: { diagnostics: "allow-new-errors" },
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  const library = (yield* project.file(projectPath("src/library.ts")))!
                  const empty = (yield* project.file(projectPath("src/empty.ts")))!
                  const doomed = (yield* project.file(projectPath("src/doomed.ts")))!
                  return Draft.concat(
                    Draft.createFile(project, projectPath("src/created-empty.ts"), ""),
                    Draft.moveFile(library, projectPath("src/shared/core.ts")),
                    Draft.insertBefore(project, library.sourceFile.statements[0]!, "// core\n"),
                    Draft.moveFile(empty, projectPath("src/moved-empty.ts")),
                    Draft.deleteFile(doomed),
                  )
                }),
            })

            const { receipt } = yield* executeRecipe(recipe, undefined)
            expect(receipt.written.map((file) => file.fileName)).toEqual([
              "src/created-empty.ts",
              "src/moved-empty.ts",
              "src/shared/core.ts",
            ])
            expect(receipt.removed.map((file) => file.fileName)).toEqual([
              "src/doomed.ts",
              "src/empty.ts",
              "src/library.ts",
            ])

            expect(yield* read(root, "src/created-empty.ts")).toBe("")
            expect(yield* read(root, "src/moved-empty.ts")).toBe("")
            expect(yield* read(root, "src/shared/core.ts")).toMatch(/^\/\/ core\n.*function other/s)
            expect(yield* exists(root, "src/library.ts")).toBe(false)
            expect(yield* exists(root, "src/empty.ts")).toBe(false)
            expect(yield* exists(root, "src/doomed.ts")).toBe(false)
          }),
        { files: { "src/empty.ts": "", "src/doomed.ts": "export {}\n" } },
      ),
    60_000,
  )

  effect(
    "keeps an edited file's mode and byte-order mark",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const script = Path.join(root, "src/script.ts")
            yield* Effect.promise(() => Fs.chmod(script, 0o755))
            const recipe = Recipe.define("edit-script", {
              version: "1.0.0",
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  const file = (yield* project.file(projectPath("src/script.ts")))!
                  return Draft.insertAfter(project, file.sourceFile.statements[0]!, "\nexport {}")
                }),
            })
            yield* executeRecipe(recipe, undefined)

            const bytes = yield* Effect.promise(() => Fs.readFile(script))
            expect(bytes.toString("utf8")).toBe("\uFEFFexport const script = 1\nexport {}\n")
            expect((yield* Effect.promise(() => Fs.stat(script))).mode & 0o777).toBe(0o755)
          }),
        { files: { "src/script.ts": "\uFEFFexport const script = 1\n" } },
      ),
    60_000,
  )

  effect(
    "preserves a moved file's mode and byte-order mark",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const source = Path.join(root, "src/script.ts")
            yield* Effect.promise(() => Fs.chmod(source, 0o755))
            const recipe = Recipe.define("move-script", {
              version: "1.0.0",
              policies: { diagnostics: "allow-new-errors" },
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  return Draft.moveFile(
                    (yield* project.file(projectPath("src/script.ts")))!,
                    projectPath("src/moved.ts"),
                  )
                }),
            })
            yield* executeRecipe(recipe, undefined)
            const moved = Path.join(root, "src/moved.ts")
            expect((yield* Effect.promise(() => Fs.readFile(moved))).toString("utf8")).toBe(
              "\uFEFFexport const script = 1\n",
            )
            expect((yield* Effect.promise(() => Fs.stat(moved))).mode & 0o777).toBe(0o755)
          }),
        { files: { "src/script.ts": "\uFEFFexport const script = 1\n" } },
      ),
    60_000,
  )

  effect(
    "refuses to write through a symlink that leaves the project",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const outside = yield* Effect.promise(() =>
            Fs.mkdtemp(Path.join(Path.dirname(root), "safemods-outside-")),
          )
          yield* Effect.promise(() => Fs.symlink(outside, Path.join(root, "src/escape"), "dir"))

          const plan = yield* verified(createFile(app, "src/escape/outside.ts", "export {}\n"))
          const failure = yield* Effect.flip(Application.applyVerifiedPlan(plan))
          expect(failure._tag).toBe("ApplicationFailure")
          expect(yield* exists(outside, "outside.ts")).toBe(false)
          yield* Effect.promise(() => Fs.rm(outside, { recursive: true, force: true }))
        }),
      ),
    60_000,
  )

  effect(
    "accepts only the verified plan object that verification issued",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const issued = yield* verified(createFile(app, "src/created.ts", "export {}\n"))
          const forgeries: ReadonlyArray<Verification.VerifiedPlan> = [
            { ...issued },
            { ...issued, preview: structuredClone(issued.preview) },
          ]
          for (const forgery of forgeries) {
            const failure = yield* Effect.flip(Application.applyVerifiedPlan(forgery))
            expect(failure._tag).toBe("ApplicationFailure")
          }
          expect(yield* exists(root, "src/created.ts")).toBe(false)
        }),
      ),
    60_000,
  )

  effect(
    "rechecks every touched file and writes nothing when one changed after verification",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("comment-imports", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const imports = yield* Query.collect(Query.imports(project))
                return Draft.concat(
                  ...imports.map(({ value }) => Draft.insertBefore(project, value, "// seen\n")),
                )
              }),
          })
          const plan = yield* verified(recipe)
          expect(plan.preview.files.length).toBeGreaterThan(1)
          const barrel = yield* read(root, "src/barrel.ts")
          yield* write(root, "src/reexport-consumer.ts", "changed\n")

          const failure = yield* Effect.flip(Application.applyVerifiedPlan(plan))
          expect(failure).toMatchObject({
            _tag: "StalePlanError",
            fileName: "src/reexport-consumer.ts",
          })
          expect(yield* read(root, "src/reexport-consumer.ts")).toBe("changed\n")
          expect(yield* read(root, "src/barrel.ts")).toBe(barrel)
        }),
      ),
    60_000,
  )

  effect(
    "rejects when an untouched fingerprinted dependency changes after verification",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const plan = yield* verified(createFile(app, "src/created.ts", ""))
          yield* write(root, "tsconfig.json", '{ "compilerOptions": { "strict": false } }\n')
          const failure = yield* Effect.flip(Application.applyVerifiedPlan(plan))
          expect(failure).toMatchObject({ _tag: "StalePlanError", fileName: "tsconfig.json" })
          expect(yield* exists(root, "src/created.ts")).toBe(false)
        }),
      ),
    60_000,
  )

  effect(
    "does not overwrite a file that appeared at a create target",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const plan = yield* verified(createFile(app, "src/raced.ts", ""))
          yield* write(root, "src/raced.ts", "created by another process\n")
          const failure = yield* Effect.flip(Application.applyVerifiedPlan(plan))
          expect(failure._tag).toBe("StalePlanError")
          expect(yield* read(root, "src/raced.ts")).toBe("created by another process\n")
        }),
      ),
    60_000,
  )
})
