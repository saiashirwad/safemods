import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { asAssertionToSatisfies } from "../../examples/as-assertion-to-satisfies.ts"
import * as Recipe from "../../src/Recipe.ts"
import { withFixture, read } from "../utils/fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"

const fixture = "migrations/as-assertion-to-satisfies"

describe("as-assertion-to-satisfies", () => {
  effect(
    "rewrites only safe contextual assertions and preserves narrower inference",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const { plan, verified } = yield* executeRecipe(asAssertionToSatisfies, undefined)

            expect(plan.edits).toHaveLength(2)
            expect(plan.unsupported.map(({ reason }) => reason).sort()).toEqual([
              "chained assertion requires manual review",
              "const assertion is not a type conformance check",
              "parenthesized assertion requires manual review",
            ])
            expect(verified.diagnosticDiff.introduced).toHaveLength(0)

            const source = yield* read(root, "src/config.ts")
            expect(source).toContain(
              'const route = { path: "/health", method: "GET" } satisfies Route',
            )
            expect(source).toContain(
              'const routes = [{ path: "/", method: "GET" }] satisfies Route[]',
            )
            expect(source).toContain('const healthPath: "/health" = route.path')
            expect(source).toContain('const firstMethod: "GET" = routes[0]!.method')
            expect(source).toContain(
              'const parenthesized = ({ path: "/parenthesized", method: "GET" }) as Route',
            )
            expect(source).toContain(
              'const chained = { path: "/chained", method: "GET" } as unknown as Route',
            )
            expect(source).toContain('const literal = "GET" as const')
            expect(source).toContain('acceptRoute({ path: "/call", method: "GET" } as Route)')
            expect(source).toContain('export default { path: "/default", method: "GET" } as Route')

            const second = yield* Recipe.run(asAssertionToSatisfies, undefined)
            expect(second.edits).toHaveLength(0)
            expect(second.unsupported).toHaveLength(3)
          }),
        { fixture },
      ),
  )
})
