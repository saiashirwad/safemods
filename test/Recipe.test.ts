import { describe, effect, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as Draft from "../src/Draft.ts"
import { PlanBuildError } from "../src/Plan.ts"
import * as Query from "../src/Query.ts"
import * as Recipe from "../src/Recipe.ts"
import { fixtureProject, withFixture } from "./utils/fixture.ts"

describe("recipe planning", () => {
  effect(
    "validates input through the recipe schema and records its encoded form",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          const received: Array<{ readonly name: string; readonly count: number }> = []
          const recipe = Recipe.define("schema-recipe", {
            version: "1.0.0",
            schema: Schema.Struct({ name: Schema.NonEmptyString, count: Schema.FiniteFromString }),
            run: (input) =>
              Effect.sync(() => {
                received.push(input)
                return Draft.empty
              }),
          })

          const plan = yield* Recipe.run(recipe, { name: "valid", count: 42 })
          expect(received).toEqual([{ name: "valid", count: 42 }])
          expect(plan.recipe.options).toEqual({ name: "valid", count: "42" })

          const failure = yield* Effect.flip(Recipe.run(recipe, { name: "", count: 42 }))
          expect(failure).toBeInstanceOf(Recipe.RecipeInputError)
        }),
      ),
    60_000,
  )

  effect(
    "rejects unsatisfiable or non-finite policy bounds when the plan is built",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          for (const policies of [
            { matchCount: { min: 4, max: 3 } },
            { matchCount: { min: -1 } },
            { matchCount: { max: 1.5 } },
            { maxAffectedFiles: Infinity },
          ]) {
            const recipe = Recipe.define("bad-bounds", {
              version: "1.0.0",
              policies,
              run: () => Effect.succeed(Draft.empty),
            })
            expect(yield* Effect.flip(Recipe.run(recipe, undefined))).toBeInstanceOf(PlanBuildError)
          }
        }),
      ),
    60_000,
  )

  effect(
    "keeps separate evidence when two queries select the same node for different reasons",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("two-reasons", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const calls = yield* Query.collect(Query.calls(project))
                const narrowed = calls.map((call) => ({
                  ...call,
                  evidence: [...call.evidence, { criterion: "narrowed", facts: {} }],
                }))
                return Draft.concat(
                  Draft.replaceEach(calls, ({ project, value }) =>
                    Draft.insertBefore(project, value, "/* a */"),
                  ),
                  Draft.replaceEach(narrowed, ({ project, value }) =>
                    Draft.insertAfter(project, value, "/* b */"),
                  ),
                )
              }),
          })
          const plan = yield* Recipe.run(recipe, undefined)
          expect(plan.evidence).toHaveLength(plan.edits.length)
          expect(new Set(plan.edits.flatMap((edit) => edit.evidenceIds)).size).toBe(
            plan.edits.length,
          )
        }),
      ),
    60_000,
  )
})
