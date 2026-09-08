import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { layer as nodeLayer, workspaceLayerNode } from "../src/Node.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as Draft from "../src/Draft/index.ts"
import { executeRecipe } from "./utils/execute-recipe.ts"
import * as Recipe from "../src/Recipe.ts"
import { Workspace } from "../src/Workspace/index.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"

describe("declarative transformations API (@effect/vitest)", () => {
  describe("automated cleanup", () => {
    effect(
      "cleans up unused imports automatically with Draft.cleanUnused",
      () =>
        withFixture((root, app) =>
          Effect.gen(function* () {
            const mainLayer = nodeLayer.pipe(
              Layer.provideMerge(Layer.succeed(Workspace, yield* Workspace)),
            )

            const addUnusedRecipe = Recipe.define("add-unused-import", {
              version: "1.0.0",
              policies: [{ diagnostics: "allow-new-errors" }],
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  return yield* Draft.imports.addNamed(project, "src/consumer.ts", {
                    module: "effect",
                    name: "DanglingUnusedSymbol",
                  })
                }),
            })

            yield* executeRecipe(addUnusedRecipe, undefined).pipe(Effect.provide(mainLayer))

            const cleanRecipe = Recipe.define("clean-unused-recipe", {
              version: "1.0.0",
              policies: [{ diagnostics: "allow-new-errors" }],
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  return yield* Draft.cleanUnused(project)
                }),
            })

            const cleanWorkspaceLayer = workspaceLayerNode({ projects: [app] }, { cwd: root })
            const cleanMainLayer = nodeLayer.pipe(Layer.provideMerge(cleanWorkspaceLayer))
            const cleanExecution = yield* executeRecipe(cleanRecipe, undefined).pipe(
              Effect.provide(cleanMainLayer),
            )
            expect(cleanExecution.plan.edits.length).toBeGreaterThanOrEqual(1)

            const consumerContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8"),
            )
            expect(consumerContent).not.toContain("DanglingUnusedSymbol")
          }),
        ),
      60_000,
    )
  })
})
