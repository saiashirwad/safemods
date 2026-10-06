import { describe, effect, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as Proposal from "../src/Proposal.ts"
import * as Recipe from "../src/Recipe.ts"
import { verify } from "../src/Migration/index.ts"
import { read, withFixture, write } from "./utils/fixture.ts"

describe("recipe planning", () => {
  effect(
    "validates input through the recipe schema",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          const received: Array<{ readonly name: string; readonly count: number }> = []
          const recipe = Recipe.define("schema-recipe", {
            version: "1.0.0",
            schema: Schema.Struct({ name: Schema.NonEmptyString, count: Schema.FiniteFromString }),
            run: (_snapshot, input) =>
              Effect.sync(() => {
                received.push(input)
                return Proposal.empty
              }),
          })

          yield* verify(recipe, { name: "valid", count: 42 })
          expect(received).toEqual([{ name: "valid", count: 42 }])

          const failure = yield* Effect.flip(verify(recipe, { name: "", count: 42 }))
          expect(failure).toBeInstanceOf(Recipe.RecipeInputError)
        })
      ),
  )

  effect(
    "rejects a recipe that changes its captured inputs before verification finishes",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("captured-input", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                yield* write(root, "src/library.ts", "mutated during recipe\n")
                return Proposal.empty
              }),
          })

          const stale = yield* Effect.flip(verify(recipe, undefined))
          expect(yield* read(root, "src/library.ts")).toBe("mutated during recipe\n")
          expect(stale).toMatchObject({ _tag: "StaleMigrationError", path: "src/library.ts" })
        })
      ),
  )
})
