import { nodeFsPromises as Fs, path as Path } from "../platform/node.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../Draft/index.ts"
import { layer as nodeLayer } from "../Node/index.ts"
import * as Recipe from "../Recipe/index.ts"
import { withFixture } from "../test/declarative-fixture.ts"
import { fixtureProject } from "../test/project-fixture.ts"
import { executeRecipe } from "./RecipeExecution.ts"

describe("recipe execution workflow", () => {
  effect("runs, verifies, and applies a recipe", () =>
    withFixture((root, app) =>
      Effect.gen(function* () {
        const recipe = Recipe.define("execution-apply", {
          version: "1.0.0",
          run: () =>
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              return yield* Draft.files.create(
                project,
                "src/executed.ts",
                "export const executed = true;\n",
              )
            }),
        })

        const execution = yield* executeRecipe(recipe, undefined).pipe(Effect.provide(nodeLayer))

        expect(execution.plan.planId).toBe(execution.verified.plan.planId)
        expect(Object.isFrozen(execution.verified.preview)).toBe(true)
        expect(execution.receipt.outputs).toHaveLength(1)
        expect(
          yield* Effect.promise(() => Fs.readFile(Path.join(root, "src/executed.ts"), "utf8")),
        ).toBe("export const executed = true;\n")
      }),
    ),
  )
})
