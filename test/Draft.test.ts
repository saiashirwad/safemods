import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { layer as nodeLayer } from "../src/Node.ts"
import { executeRecipe } from "./utils/execute-recipe.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../src/Draft/index.ts"
import * as Query from "../src/Query/index.ts"
import * as Recipe from "../src/Recipe/index.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"

describe("declarative transformations API (@effect/vitest)", () => {
  describe("syntactic draft combinators", () => {
    effect(
      "manipulates imports, call arguments, and object fields preserving formatting",
      () =>
        withFixture((root, app) =>
          Effect.gen(function* () {
            const draftTestRecipe = Recipe.define("draft-test-recipe", {
              version: "1.0.0",
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)

                  const d1 = yield* Draft.imports.addNamed(project, "src/consumer.ts", {
                    module: "./library.js",
                    name: "TargetInput",
                  })

                  const calls = yield* Query.calls(project).pipe(Query.collect)
                  const targetArg = calls[0]!.value.arguments[0]!
                  const d2 = yield* Draft.replace(
                    project,
                    targetArg,
                    `/* wrapped */ { value: ${targetArg.getText()} }`,
                  )

                  return yield* Draft.concat(d1, d2)
                }),
            })

            yield* executeRecipe(draftTestRecipe, undefined).pipe(Effect.provide(nodeLayer))

            const consumerContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8"),
            )
            expect(consumerContent).toContain("TargetInput")
            expect(consumerContent).toContain("/* keep this comment */ /* wrapped */ { value: 1 }")
          }),
        ),
      60_000,
    )
  })
})
