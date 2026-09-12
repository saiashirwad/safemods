import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Predicate, type Schema } from "effect"
import * as Draft from "../src/Draft/index.ts"
import * as Recipe from "../src/Recipe.ts"
import * as Verification from "../src/Verification/index.ts"
import { finalizePlan, type TransformationPlan } from "../src/Plan.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"
import { projectPath } from "./utils/domain.ts"
import type * as ProjectRelativePath from "../src/ProjectRelativePath.ts"

// SAFETY: this test sends non-canonical paths through validation.
const uncheckedPath = (value: string) => value as ProjectRelativePath.Type

const didMutate = (write: () => void): boolean => {
  try {
    write()
    return true
  } catch {
    return false
  }
}

interface TsConfigDocument {
  readonly compilerOptions?: Readonly<Record<string, Schema.Json>>
  readonly include?: Schema.Json
}

describe("issued verified plans and project identity", () => {
  effect(
    "rejects a structurally decoded plan whose paths are not canonical",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("unvalidated-paths", {
            version: "1.0.0",
            policies: { diagnostics: "allow-new-errors" },
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                return yield* Draft.files.create(
                  project,
                  projectPath("src/created.ts"),
                  "export {}\n",
                )
              }),
          })
          const plan = yield* Recipe.run(recipe, undefined)
          const unvalidated: TransformationPlan = {
            ...plan,
            sources: plan.sources.map((source) => ({
              ...source,
              fileName: uncheckedPath(`./${source.fileName}`),
            })),
            edits: plan.edits.map((edit) => ({
              ...edit,
              fileName: uncheckedPath(`./${edit.fileName}`),
            })),
          }
          const verified = yield* Verification.verify(unvalidated, recipe, undefined).pipe(
            Effect.result,
          )
          const previewed = yield* Verification.preview(unvalidated).pipe(Effect.result)
          expect(verified._tag).toBe("Failure")
          expect(previewed._tag).toBe("Failure")
        }),
      ),
    60_000,
  )

  effect(
    "rejects a finalized plan whose project config is not the live Workspace identity",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("identity-mismatch", {
            version: "1.0.0",
            policies: { diagnostics: "allow-new-errors" },
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                return yield* Draft.files.create(
                  project,
                  projectPath("src/created.ts"),
                  "export {}\n",
                )
              }),
          })
          const plan = yield* Recipe.run(recipe, undefined)
          const { schemaVersion: _, planId: __, snapshotHash: ___, ...input } = plan
          const mismatched = yield* finalizePlan({
            ...input,
            projects: input.projects.map((project) => ({
              ...project,
              configFileName: projectPath("other.json"),
            })),
          })
          const verified = yield* Verification.verify(mismatched, recipe, undefined).pipe(
            Effect.result,
          )
          const previewed = yield* Verification.preview(mismatched).pipe(Effect.result)
          expect(verified._tag).toBe("Failure")
          expect(previewed._tag).toBe("Failure")
        }),
      ),
    60_000,
  )

  effect(
    "stales verify when an extends parent or other recorded manifest input changes",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const originalConfig = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "tsconfig.json"), "utf8"),
          )
          yield* Effect.tryPromise(() =>
            Fs.writeFile(
              Path.join(root, "tsconfig.base.json"),
              `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`,
            ),
          )
          const parsedUnknown: unknown = JSON.parse(originalConfig)
          const parsed: TsConfigDocument =
            Predicate.isObject(parsedUnknown) && !Array.isArray(parsedUnknown) ? parsedUnknown : {}
          yield* Effect.tryPromise(() =>
            Fs.writeFile(
              Path.join(root, "tsconfig.json"),
              `${JSON.stringify(
                {
                  extends: "./tsconfig.base.json",
                  compilerOptions: parsed.compilerOptions ?? {},
                  include: parsed.include ?? ["src/**/*.ts"],
                },
                null,
                2,
              )}\n`,
            ),
          )

          const recipe = Recipe.define("manifest-stale", {
            version: "1.0.0",
            policies: { diagnostics: "allow-new-errors" },
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                return yield* Draft.files.create(
                  project,
                  projectPath("src/created.ts"),
                  "export {}\n",
                )
              }),
          })
          const plan = yield* Recipe.run(recipe, undefined)
          expect(plan.sources.some((source) => source.fileName === "tsconfig.json")).toBe(true)

          yield* Effect.tryPromise(() =>
            Fs.writeFile(
              Path.join(root, "tsconfig.json"),
              `${JSON.stringify({ compilerOptions: { strict: false } }, null, 2)}\n`,
            ),
          )
          const verified = yield* Verification.verify(plan, recipe, undefined).pipe(Effect.result)
          const previewed = yield* Verification.preview(plan).pipe(Effect.result)
          expect(verified._tag).toBe("Failure")
          expect(previewed._tag).toBe("Failure")
          if (verified._tag === "Failure") expect(verified.failure._tag).toBe("StalePlanError")
          if (previewed._tag === "Failure") expect(previewed.failure._tag).toBe("StalePlanError")
        }),
      ),
    60_000,
  )

  effect(
    "freezes nested values on an issued verified plan and still exposes them for apply",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("issued-freeze", {
            version: "1.0.0",
            policies: { diagnostics: "allow-new-errors" },
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                return yield* Draft.files.create(
                  project,
                  projectPath("src/created.ts"),
                  "export {}\n",
                )
              }),
          })
          const plan = yield* Recipe.run(recipe, undefined)
          const verified = yield* Verification.verify(plan, recipe, undefined)
          const project = verified.plan.projects[0]
          const file = verified.preview.files[0]
          expect(project).toBeDefined()
          expect(file).toBeDefined()
          if (project === undefined || file === undefined) return
          const originalConfig = project.configFileName
          const originalFileName = file.fileName
          expect(
            didMutate(() => {
              // SAFETY: the test asserts the issued capability rejects mutation.
              const target = project as { configFileName: string }
              target.configFileName = "mutated.json"
            }),
          ).toBe(false)
          expect(
            didMutate(() => {
              // SAFETY: the test asserts nested preview state is not caller-mutable.
              const target = file as { fileName: string }
              target.fileName = "src/mutated.ts"
            }),
          ).toBe(false)
          expect(project.configFileName).toBe(originalConfig)
          expect(file.fileName).toBe(originalFileName)
          expect(verified.plan.planId).toBe(plan.planId)
          expect(verified.diagnosticDiff).toBeDefined()
        }),
      ),
    60_000,
  )
})
