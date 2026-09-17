import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { layer as nodeLayer } from "../src/Node.ts"
import { executeRecipe } from "./utils/execute-recipe.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { SyntaxKind } from "typescript/unstable/ast"
import { isFunctionDeclaration } from "typescript/unstable/ast/is"
import * as Draft from "../src/Draft/index.ts"
import * as Query from "../src/Query/index.ts"
import * as Recipe from "../src/Recipe.ts"
import { Workspace } from "../src/Workspace/index.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"
import { projectPath } from "./utils/domain.ts"

describe("recipe project-file composition", () => {
  effect(
    "supports validated ProjectFile handles with scoped operations",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const fileRecipe = Recipe.define("use-project-file", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)

                const consumerFile = yield* project.file(projectPath("src/consumer.ts"))
                expect(consumerFile.path).toBe("src/consumer.ts")

                const libraryFile = yield* project.file(projectPath("src/library.ts"))
                const targetSymbol = yield* libraryFile.symbolNamed("target")
                expect(targetSymbol.name).toBe("target")

                const callsInConsumer = yield* Query.calls(consumerFile).pipe(
                  Query.where(Query.resolvesTo(targetSymbol, { location: (c) => c.expression })),
                  Query.collect,
                )
                expect(callsInConsumer.length).toBe(1)

                const [existingImport] = yield* Query.imports(consumerFile).pipe(Query.collect)
                const importDraft = yield* Draft.insertBefore(
                  consumerFile.project,
                  existingImport!.value,
                  'import type { TargetInput } from "./library.js"\n',
                )

                const replaceDraft = yield* Draft.replaceEach(
                  callsInConsumer,
                  ({ value: call }) => {
                    const arg = call.arguments[0]!
                    return { node: arg, text: `{ value: ${arg.getText()} }` }
                  },
                )

                return yield* Draft.concat(importDraft, replaceDraft)
              }),
          })

          yield* executeRecipe(fileRecipe, undefined).pipe(Effect.provide(nodeLayer))

          const consumerContent = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8"),
          )
          expect(consumerContent).toContain("TargetInput")
          expect(consumerContent).toContain("renamed(/* keep this comment */ { value: 1 })")
        }),
      ),
    60_000,
  )

  effect(
    "ProjectFile arrays scope queries and de-duplicate repeated files",
    () =>
      withFixture((_root, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          yield* workspace.withSnapshot(
            {},
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              const libraryFile = yield* project.file(projectPath("src/library.ts"))
              const consumerFile = yield* project.file(projectPath("src/consumer.ts"))
              const targetSymbol = yield* libraryFile.symbolNamed("target")

              const callsInSlice = yield* Query.calls([libraryFile, consumerFile]).pipe(
                Query.where(Query.resolvesTo(targetSymbol, { location: (c) => c.expression })),
                Query.collect,
              )
              expect(callsInSlice.length).toBe(1)
              expect(callsInSlice[0]?.fileName).toBe("src/consumer.ts")

              const emptyCalls = yield* Query.calls([]).pipe(Query.collect)
              expect(emptyCalls).toEqual([])

              const fnDeclsInSlice = yield* Query.nodes(
                [libraryFile, consumerFile],
                isFunctionDeclaration,
                SyntaxKind.FunctionDeclaration,
              ).pipe(
                Query.filter(
                  ({ value }) =>
                    value.modifiers?.some(
                      (modifier) => modifier.kind === SyntaxKind.ExportKeyword,
                    ) ?? false,
                ),
                Query.collect,
              )
              expect(fnDeclsInSlice.length).toBe(2)
              expect(fnDeclsInSlice.map((declaration) => declaration.fileName)).toEqual([
                "src/library.ts",
                "src/library.ts",
              ])

              const callsWithDuplicates = yield* Query.calls([consumerFile, consumerFile]).pipe(
                Query.where(Query.resolvesTo(targetSymbol, { location: (c) => c.expression })),
                Query.collect,
              )
              expect(callsWithDuplicates.length).toBe(1)
            }),
          )
        }),
      ),
    60_000,
  )
})
