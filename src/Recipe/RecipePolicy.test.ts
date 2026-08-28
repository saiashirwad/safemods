import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Draft from "../Draft/index.ts"
import * as Pattern from "../Pattern/index.ts"
import * as Policy from "../Policy/index.ts"
import * as Query from "../Query/index.ts"
import * as Recipe from "../Recipe/index.ts"
import * as Verification from "../Verification/index.ts"
import { withFixture } from "../test/declarative-fixture.ts"
import { fixtureProject } from "../test/project-fixture.ts"

describe("recipe policy and concurrent composition", () => {
  effect(
    "composes concurrent recipes with Recipe.all and executes conditionally with Recipe.branch",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const recipeA = Recipe.define("recipe-a", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                return yield* Draft.imports.addNamed(project, "src/consumer.ts", {
                  module: "effect",
                  name: "Chunk",
                })
              }),
          })

          const recipeB = Recipe.define("recipe-b", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                return yield* Draft.imports.addNamed(project, "src/reexport-consumer.ts", {
                  module: "effect",
                  name: "HashSet",
                })
              }),
          })

          const parallelRecipe = Recipe.all([recipeA, recipeB])
          const branchedRecipe = Recipe.branch(
            () => true,
            parallelRecipe,
            Recipe.define("noop", { version: "1.0.0", run: () => Effect.succeed(Draft.empty) }),
          )

          const plan = yield* Recipe.run(branchedRecipe, undefined)
          expect(plan.edits).toHaveLength(2)
        }),
      ),
    60_000,
  )

  effect("preserves compiled durable policies and runtime rules across combinators", () =>
    Effect.sync(() => {
      const guarded = Recipe.define("guarded", {
        version: "1.0.0",
        policies: [Policy.atMostFiles(2), Policy.idempotent(), Policy.fixesError(999)],
        run: () => Effect.succeed(Draft.empty),
      })
      const bounded = Recipe.define("bounded", {
        version: "1.0.0",
        policies: [Policy.matches({ min: 3 })],
        run: () => Effect.succeed(Draft.empty),
      })

      const composedCases: ReadonlyArray<
        readonly [Recipe.Recipe<any, any, any>, number | undefined]
      > = [
        [Recipe.pipe(guarded, bounded), 3],
        [Recipe.all([guarded, bounded]), 3],
        [Recipe.branch(() => true, guarded, bounded), 0],
        [Recipe.when(() => true, guarded), 0],
      ]
      for (const [composed, expectedMin] of composedCases) {
        expect(composed.policies.maxAffectedFiles).toBeUndefined()
        expect(composed.policies.matchCount.min).toBe(expectedMin)
        expect(composed.policies.idempotence).toBe("required")
        expect(composed.rules.map((rule) => rule.name)).toContain("fixes-error:TS999")
      }
    }),
  )

  effect("composes bounds for recipes that all run or choose one branch", () =>
    Effect.sync(() => {
      const narrower = Recipe.define("narrower-policy", {
        version: "1.0.0",
        policies: [
          Policy.atMostFiles(2),
          Policy.matches({ min: 3, max: 4 }),
          Policy.noNewErrors(),
          Policy.idempotent(),
        ],
        run: () => Effect.succeed(Draft.empty),
      })
      const wider = Recipe.define("wider-policy", {
        version: "1.0.0",
        policies: [
          Policy.atMostFiles(10),
          Policy.matches({ min: 1, max: 20 }),
          { diagnostics: "allow-new-errors" },
        ],
        run: () => Effect.succeed(Draft.empty),
      })

      for (const recipe of [Recipe.pipe(narrower, wider), Recipe.all([narrower, wider])]) {
        expect(recipe.policies.maxAffectedFiles).toBe(12)
        expect(recipe.policies.matchCount).toEqual({ min: 4, max: 24 })
        expect(recipe.policies.diagnostics).toBe("no-new-errors")
        expect(recipe.policies.idempotence).toBe("required")
      }

      const branched = Recipe.branch(() => true, narrower, wider)
      expect(branched.policies.maxAffectedFiles).toBe(10)
      expect(branched.policies.matchCount).toEqual({ min: 1, max: 20 })
      expect(branched.policies.diagnostics).toBe("no-new-errors")
      expect(branched.policies.idempotence).toBe("required")
    }),
  )

  effect(
    "verifies the summed match count of bounded child recipes",
    () =>
      withFixture(() =>
        Effect.gen(function* () {
          const child = (name: string) =>
            Recipe.define(name, {
              version: "1.0.0",
              policies: [Policy.exactly(2)],
              run: () => Effect.succeed({ ...Draft.empty, matches: 2 }),
            })
          const recipe = Recipe.all([child("first"), child("second")])
          const plan = yield* Recipe.run(recipe, undefined)
          expect(plan.measurements?.matches).toBe(4)
          expect(plan.policies.matchCount).toEqual({ min: 4, max: 4 })
          yield* Verification.verify(plan, recipe, undefined)
        }),
      ),
    60_000,
  )

  effect(
    "Recipe.pipe keeps earlier and later evidence when a later stage makes no edits",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const editStage = Recipe.define("pipe-edit-stage", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                return yield* Draft.imports.addNamed(project, "src/consumer.ts", {
                  module: "./library.js",
                  name: "TargetInput",
                })
              }),
          })
          const auditStage = Recipe.define("pipe-audit-stage", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const libraryFile = yield* project.file("src/library.ts")
                const decls = yield* Query.match(
                  libraryFile,
                  Pattern.functionDeclaration({ exported: true }),
                ).pipe(Query.collect)
                return yield* Draft.audit(decls)
              }),
          })

          const piped = Recipe.pipe(editStage, auditStage)
          const editPlan = yield* Recipe.run(editStage, undefined)
          const auditPlan = yield* Recipe.run(auditStage, undefined)
          const pipedPlan = yield* Recipe.run(piped, undefined)

          expect(auditPlan.edits).toHaveLength(0)
          expect(auditPlan.evidence.length).toBeGreaterThan(0)
          expect(editPlan.edits.length).toBeGreaterThan(0)
          expect(pipedPlan.edits.length).toBe(editPlan.edits.length)
          expect(pipedPlan.measurements?.matches).toBe(
            (editPlan.measurements?.matches ?? 0) + (auditPlan.measurements?.matches ?? 0),
          )
          const pipedEvidenceIds = new Set(pipedPlan.evidence.map((item) => item.id))
          for (const item of editPlan.evidence) {
            expect(pipedEvidenceIds.has(item.id)).toBe(true)
          }
          for (const item of auditPlan.evidence) {
            expect(pipedEvidenceIds.has(item.id)).toBe(true)
          }
        }),
      ),
    60_000,
  )

  effect(
    "Recipe.pipe deduplicates identical helper evidence when later stages edit the same range",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const bump = Recipe.define("bump-first-arg", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const calls = yield* Query.calls(project).pipe(
                  Query.within("src/consumer.ts"),
                  Query.withArgCount(1),
                  Query.collect,
                )
                const call = calls.find((selection) => selection.value.arguments[0] !== undefined)
                expect(call).toBeDefined()
                if (call === undefined) return Draft.empty
                const arg = call.value.arguments[0]!
                return yield* Draft.replace(project, arg, arg.getText())
              }),
          })
          const again = Recipe.define("wrap-same-arg-again", {
            version: "1.0.0",
            run: () =>
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const calls = yield* Query.calls(project).pipe(
                  Query.within("src/consumer.ts"),
                  Query.withArgCount(1),
                  Query.collect,
                )
                const call = calls.find((selection) => selection.value.arguments[0] !== undefined)
                expect(call).toBeDefined()
                if (call === undefined) return Draft.empty
                const arg = call.value.arguments[0]!
                return yield* Draft.replace(project, arg, arg.getText())
              }),
          })
          const plan = yield* Recipe.run(Recipe.pipe(bump, again), undefined)
          const wrapIds = plan.evidence.filter((item) => item.id.includes("node:replace"))
          expect(new Set(wrapIds.map((item) => item.id)).size).toBe(wrapIds.length)

          const conflictingA = Recipe.define("conflict-a", {
            version: "1.0.0",
            run: () =>
              Effect.succeed({
                edits: [],
                evidence: [{ id: "shared", kind: "file-operation", facts: { kind: "create" } }],
                matches: 1,
              }),
          })
          const conflictingB = Recipe.define("conflict-b", {
            version: "1.0.0",
            run: () =>
              Effect.succeed({
                edits: [],
                evidence: [{ id: "shared", kind: "file-operation", facts: { kind: "delete" } }],
                matches: 1,
              }),
          })
          const pipedConflict = yield* Recipe.run(
            Recipe.pipe(conflictingA, conflictingB),
            undefined,
          ).pipe(Effect.flip)
          expect(pipedConflict._tag).toBe("DraftEvidenceConflict")
          const allConflict = yield* Recipe.run(
            Recipe.all([conflictingA, conflictingB]),
            undefined,
          ).pipe(Effect.flip)
          expect(allConflict._tag).toBe("DraftEvidenceConflict")
        }),
      ),
    60_000,
  )
})
