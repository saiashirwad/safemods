import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { packageEntryPointSplit } from "../../examples/package-entry-point-split.ts"
import * as Recipe from "../../src/Recipe.ts"
import { fixturePath as fixtureDirectory, withFixture, read } from "../utils/fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"

const fixture = "migrations/package-entry-point-split"
const fixturePath = fixtureDirectory(fixture)
describe("package-entry-point-split", () => {
  effect(
    "moves unambiguous imports and exports while reporting declarations needing a choice",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const { plan, verified } = yield* executeRecipe(packageEntryPointSplit, undefined)

            expect(plan.edits).toHaveLength(6)
            expect(plan.unsupported).toHaveLength(5)
            expect(verified.preview.files).toHaveLength(4)
            expect(verified.diagnosticDiff.introduced).toHaveLength(0)
            expect(
              verified.diagnosticDiff.unchanged.some((diagnostic) => diagnostic.code === 2322),
            ).toBe(true)

            expect(yield* read(root, "src/http/session.ts")).toContain('from "@acme/sdk/auth"')
            expect(yield* read(root, "src/billing/invoices.ts")).toContain(
              "from '@acme/sdk/billing'",
            )
            const index = yield* read(root, "src/index.ts")
            expect(index).toContain('type Session } from "@acme/sdk/auth"')
            expect(index).toContain('type ListInvoicesOptions } from "@acme/sdk/billing"')
            expect(index).toContain('{ sdkVersion } from "@acme/sdk"')

            expect(yield* read(root, "src/lazy.ts")).toBe(yield* read(fixturePath, "src/lazy.ts"))
            const publicTypes = yield* read(root, "src/types/public.ts")
            expect(publicTypes).toContain('from "@acme/sdk/auth"')
            expect(publicTypes).toContain("from '@acme/sdk/billing'")
            expect(yield* read(root, "src/version.ts")).toContain(
              'export const packageName = "@acme/sdk"',
            )

            const reasons = plan.unsupported.map(({ reason }) => reason)
            expect(reasons).toContain(
              "This declaration mixes exports from different package entry points",
            )
            expect(reasons).toContain(
              "The root entry point is ambiguous here; choose @acme/sdk/auth or @acme/sdk/billing manually",
            )

            const second = yield* Recipe.run(packageEntryPointSplit, undefined)
            expect(second.edits).toHaveLength(0)
            expect(second.unsupported).toHaveLength(5)
          }),
        { fixture },
      ),
  )
})
