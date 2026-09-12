import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { layer as nodeLayer } from "../src/Node.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as Draft from "../src/Draft/index.ts"
import { executeRecipe } from "./utils/execute-recipe.ts"
import * as Recipe from "../src/Recipe.ts"
import { Workspace } from "../src/Workspace/index.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"
import { projectPath } from "./utils/domain.ts"

describe("declarative transformations API (@effect/vitest)", () => {
  describe("file lifecycle operations in plans", () => {
    effect(
      "creates and moves files in a single plan",
      () =>
        withFixture((root, app) =>
          Effect.gen(function* () {
            const mainLayer = nodeLayer.pipe(
              Layer.provideMerge(Layer.succeed(Workspace, yield* Workspace)),
            )

            const fileLifecycleRecipe = Recipe.define("file-lifecycle", {
              version: "1.0.0",
              policies: { diagnostics: "allow-new-errors" },
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)

                  const d1 = yield* Draft.files.create(
                    project,
                    projectPath("src/utils.ts"),
                    "export const magicNumber = 42;\n",
                  )

                  const d2 = yield* Draft.files.move(
                    project,
                    projectPath("src/library.ts"),
                    projectPath("src/shared/core.ts"),
                  )

                  return yield* Draft.concat(d1, d2)
                }),
            })

            const execution = yield* executeRecipe(fileLifecycleRecipe, undefined).pipe(
              Effect.provide(mainLayer),
            )
            expect(execution.plan.fileOperations.length).toBe(2)
            expect(execution.plan.edits).toEqual([])
            expect(execution.verified.preview.files.length).toBeGreaterThanOrEqual(2)

            const createdContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/utils.ts"), "utf8"),
            )
            expect(createdContent).toContain("export const magicNumber = 42;")

            const movedContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/shared/core.ts"), "utf8"),
            )
            expect(movedContent).toContain("function other(value: number)")

            const movedAway = yield* Effect.tryPromise(() =>
              Fs.access(Path.join(root, "src/library.ts")).then(
                () => true,
                () => false,
              ),
            )
            expect(movedAway).toBe(false)
          }),
        ),
      60_000,
    )
  })
})
