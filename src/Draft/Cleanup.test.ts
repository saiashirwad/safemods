import { path as Path, nodeFsPromises as Fs } from "../platform/node.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as Draft from "../Draft/index.ts"
import { executeRecipe } from "../Execution/index.ts"
import { layer as nodeLayer, workspaceLayerNode } from "../Node/index.ts"
import * as Recipe from "../Recipe/index.ts"
import { Workspace } from "../Workspace/index.ts"
import { withFixture } from "../test/declarative-fixture.ts"
import { fixtureProject } from "../test/project-fixture.ts"

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
              policies: [{ diagnostics: "exact-delta" }],
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  return yield* Draft.imports.addNamed(project, "src/consumer.ts", {
                    module: "effect",
                    name: "DanglingUnusedSymbol",
                  })
                }),
            })

            yield* executeRecipe(addUnusedRecipe, undefined, { mode: "apply" }).pipe(
              Effect.provide(mainLayer),
            )

            const cleanRecipe = Recipe.define("clean-unused-recipe", {
              version: "1.0.0",
              policies: [{ diagnostics: "exact-delta" }],
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  return yield* Draft.cleanUnused(project)
                }),
            })

            const cleanWorkspaceLayer = workspaceLayerNode({ projects: [app] }, { cwd: root })
            const cleanMainLayer = nodeLayer.pipe(Layer.provideMerge(cleanWorkspaceLayer))
            const cleanExecution = yield* executeRecipe(cleanRecipe, undefined, {
              mode: "apply",
            }).pipe(Effect.provide(cleanMainLayer))
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
