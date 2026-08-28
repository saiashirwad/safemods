import { executeRecipe } from "../../Execution/index.ts"
import { nodeFsPromises as Fs, path as Path, layer as nodeLayer } from "../../platform/node.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Application from "../../Application/index.ts"
import * as Draft from "../../Draft/index.ts"
import * as Policy from "../../Policy/index.ts"
import * as Recipe from "../../Recipe/index.ts"
import * as Verification from "../../Verification/index.ts"
import { withFixture } from "../../test/declarative-fixture.ts"
import { fixtureProject } from "../../test/project-fixture.ts"

const exists = (fileName: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    Fs.stat(fileName).then(
      () => true,
      () => false,
    ),
  )

describe("Node application race and filesystem safety", () => {
  effect("rejects a create-target race without overwriting the raced file", () =>
    withFixture((root, app) =>
      Effect.gen(function* () {
        const recipe = Recipe.define("create-race", {
          version: "1.0.0",
          policies: [Policy.noNewErrors()],
          run: () =>
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              return yield* Draft.files.create(project, "src/raced.ts", "")
            }),
        })
        const plan = yield* Recipe.run(recipe, undefined)
        const verified = yield* Verification.verify(plan, recipe, undefined)
        const target = Path.join(root, "src/raced.ts")
        yield* Effect.promise(() => Fs.writeFile(target, "created by another process\n"))

        const result = yield* Application.applyVerifiedPlan(verified).pipe(
          Effect.provide(nodeLayer),
          Effect.result,
        )
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure") expect(result.failure._tag).toBe("StalePlanError")
        expect(yield* Effect.promise(() => Fs.readFile(target, "utf8"))).toBe(
          "created by another process\n",
        )
      }),
    ),
  )

  effect("creates, moves, and deletes empty files without using empty text as absence", () =>
    withFixture((root, app) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Promise.all([
            Fs.writeFile(Path.join(root, "src/move-empty.ts"), ""),
            Fs.writeFile(Path.join(root, "src/delete-empty.ts"), ""),
          ]),
        )
        const recipe = Recipe.define("empty-file-lifecycle", {
          version: "1.0.0",
          policies: [{ diagnostics: "exact-delta" }],
          run: () =>
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              const create = yield* Draft.files.create(project, "src/created-empty.ts", "")
              const move = yield* Draft.files.move(
                project,
                "src/move-empty.ts",
                "src/moved-empty.ts",
              )
              const remove = yield* Draft.files.delete(project, "src/delete-empty.ts")
              return Draft.concat(create, move, remove)
            }),
        })

        yield* executeRecipe(recipe, undefined, { mode: "apply" }).pipe(Effect.provide(nodeLayer))

        expect(yield* exists(Path.join(root, "src/created-empty.ts"))).toBe(true)
        expect(
          yield* Effect.promise(() => Fs.readFile(Path.join(root, "src/created-empty.ts"), "utf8")),
        ).toBe("")
        expect(yield* exists(Path.join(root, "src/move-empty.ts"))).toBe(false)
        expect(yield* exists(Path.join(root, "src/moved-empty.ts"))).toBe(true)
        expect(
          yield* Effect.promise(() => Fs.readFile(Path.join(root, "src/moved-empty.ts"), "utf8")),
        ).toBe("")
        expect(yield* exists(Path.join(root, "src/delete-empty.ts"))).toBe(false)
      }),
    ),
  )
})
