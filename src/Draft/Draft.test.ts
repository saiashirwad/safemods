import { executeRecipe } from "../Execution/index.ts"
import { path as Path, nodeFsPromises as Fs } from "../platform/node.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../Draft/index.ts"
import { layer as nodeLayer } from "../Node/index.ts"
import * as Policy from "../Policy/index.ts"
import * as Query from "../Query/index.ts"
import * as Recipe from "../Recipe/index.ts"
import { withFixture } from "../test/declarative-fixture.ts"
import { fixtureProject } from "../test/project-fixture.ts"

describe("declarative transformations API (@effect/vitest)", () => {
  describe("syntactic draft combinators and rename", () => {
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

                  return Draft.concat(d1, d2)
                }),
            })

            yield* executeRecipe(draftTestRecipe, undefined, { mode: "apply" }).pipe(
              Effect.provide(nodeLayer),
            )

            const consumerContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8"),
            )
            expect(consumerContent).toContain("TargetInput")
            expect(consumerContent).toContain("/* keep this comment */ /* wrapped */ { value: 1 }")
          }),
        ),
      60_000,
    )

    effect(
      "renames symbols across all declarations, imports, and usages with Draft.renameSymbol",
      () =>
        withFixture((root, app) =>
          Effect.gen(function* () {
            const renameRecipe = Recipe.define("rename-other-symbol", {
              version: "1.0.0",
              policies: [Policy.noNewErrors()],
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  const otherSymbol = yield* project.symbolNamed("other", {
                    within: "src/library.ts",
                  })

                  return yield* Draft.renameSymbol(project, otherSymbol, "transformedOther")
                }),
            })

            const execution = yield* executeRecipe(renameRecipe, undefined, {
              mode: "apply",
            }).pipe(Effect.provide(nodeLayer))
            expect(execution.plan.edits.length).toBeGreaterThanOrEqual(2)

            const libContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/library.ts"), "utf8"),
            )
            const consumerContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8"),
            )

            expect(libContent).toContain("function transformedOther(value: number)")
            // The consumer's plain named import keeps its local binding via an
            // alias, so its usages stay untouched.
            expect(consumerContent).toContain(
              "import { transformedOther as other, target as renamed }",
            )
            expect(consumerContent).toContain("other(2)")
          }),
        ),
      60_000,
    )
  })
})
