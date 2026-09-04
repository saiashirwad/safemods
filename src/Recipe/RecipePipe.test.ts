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

describe("recipe sequential composition", () => {
  effect(
    "composes sequential recipes on the SAME file via Recipe.pipe without edit corruption",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const step1 = Recipe.define("step1-add-import", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                return yield* Draft.imports.addNamed(project, "src/consumer.ts", {
                  module: "./library.js",
                  name: "TargetInput",
                })
              }),
          })

          const step2 = Recipe.define("step2-wrap-arg", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const target = yield* project.symbolNamed("target", { within: "src/library.ts" })
                const calls = yield* Query.calls(project).pipe(
                  Query.within("src/consumer.ts"),
                  Query.where(Query.resolvesTo(target, { location: (c) => c.expression })),
                  Query.collect,
                )
                return yield* Draft.replaceEach(calls, ({ value: call }) => {
                  const arg = call.arguments[0]!
                  return { node: arg, text: `{ value: ${arg.getText()} }` }
                })
              }),
          })

          const piped = Recipe.pipe(step1, step2)
          yield* executeRecipe(piped, undefined).pipe(Effect.provide(nodeLayer))

          const consumerContent = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8"),
          )
          expect(consumerContent).toContain("TargetInput")
          expect(consumerContent).toContain("renamed(/* keep this comment */ { value: 1 })")
        }),
      ),
    60_000,
  )
})
