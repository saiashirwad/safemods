import { path as Path, nodeFsPromises as Fs } from "./platform/node.ts"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer, type Stream } from "effect"
import type { CallExpression, Node } from "typescript/unstable/ast"
import { executeRecipe } from "./Execution/index.ts"
import * as Application from "./Application/index.ts"
import * as Pattern from "./Pattern/index.ts"
import * as Plan from "./Plan/index.ts"
import type * as Query from "./Query/index.ts"
import * as Recipe from "./Recipe/index.ts"
import type * as Verification from "./Verification/index.ts"
import { layer as nodeLayer, workspaceLayerNode } from "./Node/index.ts"
import { wrapTargetInput, type WrapTargetInput } from "./test/wrap-target-input.ts"
import { migrateImportSource, type MigrateImportSourceInput } from "./test/migrate-import-source.ts"
import { withFixture } from "./test/declarative-fixture.ts"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

export type _RecipeInputInference = Assert<
  Equal<Parameters<typeof wrapTargetInput.run>[0], WrapTargetInput>
>

declare const _anyProject: Parameters<typeof Query.calls>[0]
export type _CallInference = Assert<
  Equal<
    ReturnType<typeof Query.calls> extends Stream.Stream<infer S, infer _E, infer _R>
      ? S extends Query.Selection<infer Node>
        ? Node
        : never
      : never,
    CallExpression
  >
>

const _rawPlanIsNotApplicationAuthority = (plan: Plan.TransformationPlan) =>
  // @ts-expect-error — Application accepts only a Verified Plan
  Application.applyVerifiedPlan(plan)
void _rawPlanIsNotApplicationAuthority

const _verifiedPlanIsApplicationAuthority = (verified: Verification.VerifiedPlan) =>
  Application.applyVerifiedPlan(verified)
void _verifiedPlanIsApplicationAuthority

const _booleanPredicate = Pattern.predicate("boolean-node", (_node: Node) => true)
type PredicateOutput<P> = P extends Pattern.Pattern<infer _N, infer Out> ? Out : never
export type _BooleanPredicateYieldsNode = Assert<
  Equal<PredicateOutput<typeof _booleanPredicate>, Node>
>

const stressFixture = fileURLToPath(new URL("../fixtures/stress/", import.meta.url))

describe("candidate public API (@effect/vitest)", () => {
  effect(
    "runs query → plan → preview → verify → apply as one typed pipeline",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const input: WrapTargetInput = {
            project: app,
            declarationFile: "src/library.ts",
            property: "value",
          }

          const { plan, preview, receipt, verified } = yield* executeRecipe(
            wrapTargetInput,
            input,
            { mode: "apply" },
          )

          expect(plan.recipe.name).toBe("wrap-target-input")
          expect(plan.measurements?.matches).toBe(2)
          expect(preview.files).toHaveLength(2)
          expect(verified.receipt.diagnosticDelta).toBe(0)
          expect(verified.receipt.idempotenceChecked).toBe(true)
          expect(verified.receipt.policyResults.length).toBeGreaterThan(0)
          expect(receipt.outputs).toHaveLength(2)

          const consumer = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8"),
          )
          const reexport = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/reexport-consumer.ts"), "utf8"),
          )
          expect(consumer).toContain("renamed(/* keep this comment */ { value: 1 })")
          expect(consumer).toContain("const first  =")
          expect(consumer).toContain("other(2)")
          expect(consumer).toContain("local.target(3)")
          expect(reexport).toContain("publicTarget({ value: 4 })")

          const roundTripped = yield* Plan.parsePlan(Plan.serializePlan(plan))
          expect(roundTripped.planId).toBe(plan.planId)

          const freshWorkspaceLayer = workspaceLayerNode({ projects: [app] }, { cwd: root })
          const second = yield* Recipe.run(wrapTargetInput, input).pipe(
            Effect.provide(Layer.merge(freshWorkspaceLayer, nodeLayer)),
          )
          expect(second.edits).toHaveLength(0)
          expect(second.measurements?.matches).toBe(0)
        }),
      ),
    60_000,
  )

  effect(
    "produces identical plan IDs for identical inputs",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const input: WrapTargetInput = {
            project: app,
            declarationFile: "src/library.ts",
            property: "value",
          }
          const [first, second] = yield* Effect.all([
            Recipe.run(wrapTargetInput, input),
            Recipe.run(wrapTargetInput, input),
          ])
          expect(first.planId).toBe(second.planId)
        }),
      ),
    60_000,
  )

  effect(
    "migrates an import source, preserving quote style and trivia",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const input: MigrateImportSourceInput = {
              project: app,
              from: "./legacy.js",
              to: "./replacement.js",
            }

            const { plan, receipt } = yield* executeRecipe(migrateImportSource, input, {
              mode: "apply",
            })

            expect(plan.edits).toHaveLength(1)
            expect(receipt.outputs).toHaveLength(1)

            const consumer = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/import-consumer.ts"), "utf8"),
            )
            expect(consumer).toContain("from './replacement.js'")
            expect(consumer).toContain("/* preserve import trivia */")
            expect(consumer).toContain("const importResult  =")
          }),
        { fixturePath: stressFixture },
      ),
    60_000,
  )
})
