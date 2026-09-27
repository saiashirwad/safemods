import { describe, effect, expect } from "@effect/vitest"
import { Effect, type Stream } from "effect"
import type { CallExpression } from "typescript/unstable/ast"
import * as Application from "../src/Application.ts"
import type * as Plan from "../src/Plan.ts"
import type * as Query from "../src/Query.ts"
import type * as Verification from "../src/Verification/index.ts"
import { workspacePath } from "./utils/domain.ts"
import { draftOf, executeRecipe } from "./utils/execute-recipe.ts"
import { read, withFixture } from "./utils/fixture.ts"
import { migrateImportSource } from "./utils/migrate-import-source.ts"
import { wrapTargetInput, type WrapTargetInput } from "./utils/wrap-target-input.ts"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  <Value>() => Value extends Right ? 1 : 2 ? true :
  false
type Assert<Value extends true> = Value

export type _RecipeInputInference = Assert<
  Equal<Parameters<typeof wrapTargetInput.run>[0], WrapTargetInput>
>

export type _CallInference = Assert<
  Equal<
    ReturnType<typeof Query.calls> extends Stream.Stream<Query.Selection<infer Node>, infer _E> ?
      Node :
      never,
    CallExpression
  >
>

const _rawPlanIsNotApplicationAuthority = (plan: Plan.Plan) =>
  // @ts-expect-error Application accepts only a VerifiedPlan
  Application.applyVerifiedPlan(plan)
void _rawPlanIsNotApplicationAuthority

const _verifiedPlanIsApplicationAuthority = (verified: Verification.VerifiedPlan) =>
  Application.applyVerifiedPlan(verified)
void _verifiedPlanIsApplicationAuthority

describe("run → verify → apply", () => {
  effect(
    "rewrites calls through aliases and re-exports, then finds nothing left to do",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const input: WrapTargetInput = {
            project: app,
            declarationFile: workspacePath("src/library.ts"),
            property: "value",
          }

          const { receipt, verified } = yield* executeRecipe(wrapTargetInput, input)
          expect(verified.diagnosticDiff.introduced).toEqual([])
          expect(receipt.written.map((file) => file.fileName)).toEqual([
            "src/consumer.ts",
            "src/reexport-consumer.ts",
          ])

          const consumer = yield* read(root, "src/consumer.ts")
          expect(consumer).toContain("renamed(/* keep this comment */ { value: 1 })")
          expect(consumer).toContain("const first  =")
          expect(consumer).toContain("other(2)")
          expect(consumer).toContain("local.target(3)")
          expect(yield* read(root, "src/reexport-consumer.ts")).toContain(
            "publicTarget({ value: 4 })",
          )

          const second = yield* draftOf(wrapTargetInput, input)
          expect(second.edits).toEqual([])
        })
      ),
  )

  effect("migrates an import source, preserving quote style and trivia", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          const { plan } = yield* executeRecipe(migrateImportSource, {
            project: app,
            from: "./legacy.js",
            to: "./replacement.js",
          })
          expect(plan.edits).toHaveLength(1)

          const consumer = yield* read(root, "src/import-consumer.ts")
          expect(consumer).toContain("from './replacement.js'")
          expect(consumer).toContain("/* preserve import trivia */")
          expect(consumer).toContain("const importResult  =")
        }),
      { fixture: "stress" },
    ))
})
