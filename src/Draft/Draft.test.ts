import { executeRecipe } from "../Execution/index.ts"
import { path as Path, nodeFsPromises as Fs } from "../platform/node.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../Draft/index.ts"
import { layer as nodeLayer } from "../Node/index.ts"
import * as Query from "../Query/index.ts"
import * as Recipe from "../Recipe/index.ts"
import { withFixture } from "../test/declarative-fixture.ts"
import { fixtureProject } from "../test/project-fixture.ts"

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
