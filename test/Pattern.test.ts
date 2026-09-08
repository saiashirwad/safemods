import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Pattern from "../src/Pattern.ts"
import * as Query from "../src/Query/index.ts"
import { Workspace } from "../src/Workspace/index.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"

describe("declarative transformations API (@effect/vitest)", () => {
  describe("pattern matchers and query algebra", () => {
    effect(
      "matches AST patterns declaratively and extracts typed bindings with evidence",
      () =>
        withFixture((_, app) =>
          Effect.gen(function* () {
            const workspace = yield* Workspace
            yield* workspace.withSnapshot(
              {},
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const targetSymbol = yield* project.symbolNamed("target", {
                  within: "src/library.ts",
                })

                const callPattern = Pattern.callExpression({
                  expression: Pattern.identifier({ resolvesTo: targetSymbol }),
                  arguments: Pattern.tuple([Pattern.bind("arg", Pattern.any)]),
                })

                const matches = yield* Query.match(project, callPattern).pipe(Query.collect)
                expect(matches.length).toBe(2)

                for (const match of matches) {
                  expect(match.value.call).toBeDefined()
                  expect(match.value.args[0]!.arg).toBeDefined()
                  expect(match.evidence.length).toBeGreaterThan(0)
                }
              }),
            )
          }),
        ),
      60_000,
    )

    effect(
      "keeps a /g regex name match stable across two calls",
      () =>
        withFixture((_, app) =>
          Effect.gen(function* () {
            const workspace = yield* Workspace
            yield* workspace.withSnapshot(
              {},
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const pattern = Pattern.identifier({ name: /^target$/g })
                const first = yield* Query.match(project, pattern).pipe(Query.collect)
                const second = yield* Query.match(project, pattern).pipe(Query.collect)
                expect(first.length).toBeGreaterThan(0)
                expect(second.length).toBe(first.length)
              }),
            )
          }),
        ),
      60_000,
    )
  })
})
