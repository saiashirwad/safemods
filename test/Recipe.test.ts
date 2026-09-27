import { describe, effect, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as Application from "../src/Application.ts"
import * as Draft from "../src/Draft.ts"
import * as Recipe from "../src/Recipe.ts"
import { verify } from "../src/Verification/index.ts"
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
            run: (input) =>
              Effect.sync(() => {
                received.push(input)
                return Draft.empty
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
    "plans against the bytes captured before the recipe ran",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("captured-input", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                yield* write(root, "src/library.ts", "mutated during recipe\n")
                return Draft.empty
              }),
          })

          const verified = yield* verify(recipe, undefined)
          const source = verified.preview.sources.find((item) =>
            item.fileName === "src/library.ts"
          )!
          expect(source.before.exists && source.before.text).not.toBe("mutated during recipe\n")
          expect(yield* read(root, "src/library.ts")).toBe("mutated during recipe\n")
          const stale = yield* Effect.flip(Application.applyVerifiedPlan(verified))
          expect(stale).toMatchObject({ _tag: "StalePlanError", fileName: "src/library.ts" })
        })
      ),
  )
})
