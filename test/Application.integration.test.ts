import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { layer as nodeLayer } from "../src/Node.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as Draft from "../src/Draft/index.ts"
import { executeRecipe } from "./utils/execute-recipe.ts"
import * as Recipe from "../src/Recipe/index.ts"
import { Workspace } from "../src/Workspace/index.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"

describe("declarative transformations API (@effect/vitest)", () => {
  describe("file lifecycle operations in plans", () => {
    effect(
      "creates, deletes, and moves files while rewriting relative imports across referencing files",
      () =>
        withFixture((root, app) =>
          Effect.gen(function* () {
            const mainLayer = nodeLayer.pipe(
              Layer.provideMerge(Layer.succeed(Workspace, yield* Workspace)),
            )

            const fileLifecycleRecipe = Recipe.define("file-lifecycle", {
              version: "1.0.0",
              policies: [{ diagnostics: "allow-new-errors" }],
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)

                  const d1 = yield* Draft.files.create(
                    project,
                    "src/utils.ts",
                    "export const magicNumber = 42;\n",
                  )

                  const d2 = yield* Draft.files.move(
                    project,
                    "src/library.ts",
                    "src/shared/core.ts",
                  )

                  return yield* Draft.concat(d1, d2)
                }),
            })

            const execution = yield* executeRecipe(fileLifecycleRecipe, undefined).pipe(
              Effect.provide(mainLayer),
            )
            expect(execution.plan.fileOperations?.length).toBe(2)
            expect(execution.verified.preview.files.length).toBeGreaterThanOrEqual(2)

            const createdContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/utils.ts"), "utf8"),
            )
            expect(createdContent).toContain("export const magicNumber = 42;")

            const movedContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/shared/core.ts"), "utf8"),
            )
            expect(movedContent).toContain("function other(value: number)")

            const consumerContent = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8"),
            )
            expect(consumerContent).toContain("./shared/core.js")
          }),
        ),
      60_000,
    )

    effect(
      "rewrites every module-specifier form on move, including the moved file, and fails edits at the pre-move path",
      () =>
        withFixture((root, app) =>
          Effect.gen(function* () {
            const mainLayer = nodeLayer.pipe(
              Layer.provideMerge(Layer.succeed(Workspace, yield* Workspace)),
            )
            yield* Effect.tryPromise(() =>
              Fs.writeFile(Path.join(root, "src/peer.ts"), "export const peer = 1;\n"),
            )
            yield* Effect.tryPromise(() =>
              Fs.writeFile(
                Path.join(root, "src/movable.ts"),
                [
                  "// @ts-nocheck",
                  'import { peer } from "./peer.js"',
                  'import * as peerNs from "./peer.js"',
                  'export { peer as movedPeer } from "./peer.js"',
                  'export * from "./peer.js"',
                  'const dynamic = import("./peer.js")',
                  'const required = require("./peer.js")',
                  "export { peer, peerNs, dynamic, required }",
                  "",
                ].join("\n"),
              ),
            )
            yield* Effect.tryPromise(() =>
              Fs.writeFile(
                Path.join(root, "src/specifiers.ts"),
                [
                  "// @ts-nocheck",
                  'import { peer } from "./movable.js"',
                  'import * as movableNs from "./movable.js"',
                  'export { peer as publicPeer } from "./movable.js"',
                  'export * from "./movable.js"',
                  'const dynamic = import("./movable.js")',
                  'const required = require("./movable.js")',
                  "export { movableNs, dynamic, required }",
                  "",
                ].join("\n"),
              ),
            )

            const moveRecipe = Recipe.define("move-specifiers", {
              version: "1.0.0",
              policies: [{ diagnostics: "allow-new-errors" }],
              run: () =>
                Effect.gen(function* () {
                  const project = yield* fixtureProject(app)
                  return yield* Draft.files.move(project, "src/movable.ts", "src/nested/moved.ts")
                }),
            })

            const execution = yield* executeRecipe(moveRecipe, undefined).pipe(
              Effect.provide(mainLayer),
            )
            const move = execution.plan.fileOperations?.find(
              (operation) => operation.kind === "move",
            )
            expect(move?.kind === "move" ? move.content : "").toContain("../peer.js")
            expect(execution.plan.edits.some((edit) => edit.fileName === "src/specifiers.ts")).toBe(
              true,
            )

            const moved = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/nested/moved.ts"), "utf8"),
            )
            const specifiers = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/specifiers.ts"), "utf8"),
            )
            expect(moved).toContain('from "../peer.js"')
            expect(moved).toContain('import * as peerNs from "../peer.js"')
            expect(moved).toContain('export { peer as movedPeer } from "../peer.js"')
            expect(moved).toContain('export * from "../peer.js"')
            expect(moved).toContain('import("../peer.js")')
            expect(moved).toContain('require("../peer.js")')
            expect(specifiers).toContain('from "./nested/moved.js"')
            expect(specifiers).toContain('import * as movableNs from "./nested/moved.js"')
            expect(specifiers).toContain('export { peer as publicPeer } from "./nested/moved.js"')
            expect(specifiers).toContain('export * from "./nested/moved.js"')
            expect(specifiers).toContain('import("./nested/moved.js")')
            expect(specifiers).toContain('require("./nested/moved.js")')
          }),
        ),
      60_000,
    )
  })
})
