import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { positionalToOptions } from "../../examples/positional-to-options.ts"
import * as Recipe from "../../src/Recipe.ts"
import { fixturePath as fixtureDirectory, withFixture, read as readUtf8 } from "../utils/fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"

const fixture = "migrations/positional-to-options"
const fixturePath = fixtureDirectory(fixture)

const UNCHANGED = [
  "tsconfig.json",
  "src/sessions.ts",
  "src/index.ts",
  "src/http/request.ts",
  "src/billing/invoices.ts",
  "src/users/directory.ts",
  "src/diagnostics/legacy-quota.ts",
  "src/billing/charges.ts",
  "src/users/tokens.ts",
] as const

describe("positional-to-options", () => {
  effect(
    "moves callers of every positional overload that has a matching object overload",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const input = { project: app }
            const { plan, verified, receipt } = yield* executeRecipe(positionalToOptions, input)

            expect(plan.recipe.name).toBe("positional-to-options")
            expect(verified.diagnosticDiff.introduced).toEqual([])
            expect(
              verified.diagnosticDiff.unchanged.some((diagnostic) => diagnostic.code === 2322),
            ).toBe(true)
            expect(new Set(verified.preview.files.map((file) => file.fileName))).toEqual(
              new Set([
                "src/auth/login.ts",
                "src/auth/refresh.ts",
                "src/http/middleware.ts",
                "src/billing/collect.ts",
              ]),
            )
            expect(receipt.written).toHaveLength(4)

            const originalCollect = yield* readUtf8(fixturePath, "src/billing/collect.ts")
            expect(yield* readUtf8(root, "src/billing/collect.ts")).toBe(
              originalCollect
                .replace(
                  "createCharge(customerId, amountCents)",
                  "createCharge({ customerId, amountCents })",
                )
                .replace(
                  'createCharge(customerId, amountCents * 2, "eur")',
                  'createCharge({ customerId, amountCents: amountCents * 2, currency: "eur" })',
                ),
            )
            expect(
              plan.unsupported.map(({ start, end }) => originalCollect.slice(start, end)),
            ).toEqual(["createCharge(...batch)"])

            const originalLogin = yield* readUtf8(fixturePath, "src/auth/login.ts")
            const originalRefresh = yield* readUtf8(fixturePath, "src/auth/refresh.ts")
            const originalMiddleware = yield* readUtf8(fixturePath, "src/http/middleware.ts")
            const login = yield* readUtf8(root, "src/auth/login.ts")
            const refresh = yield* readUtf8(root, "src/auth/refresh.ts")
            const middleware = yield* readUtf8(root, "src/http/middleware.ts")

            expect(login).toBe(
              originalLogin
                .replaceAll(
                  "createSession(account.userId, LOGIN_TTL_SECONDS)",
                  "createSession({ userId: account.userId, ttlSeconds: LOGIN_TTL_SECONDS })",
                )
                .replaceAll(
                  "createSession(targetUserId, IMPERSONATION_TTL_SECONDS)",
                  "createSession({ userId: targetUserId, ttlSeconds: IMPERSONATION_TTL_SECONDS })",
                ),
            )
            expect(refresh).toBe(
              originalRefresh.replaceAll(
                "openSession(userId, ttlSeconds)",
                "openSession({ userId, ttlSeconds })",
              ),
            )
            expect(middleware).toBe(
              originalMiddleware.replaceAll(
                "createSession(/* request principal */ principal.userId, COOKIE_TTL_SECONDS)",
                "createSession(/* request principal */ { userId: principal.userId, ttlSeconds: COOKIE_TTL_SECONDS })",
              ),
            )

            expect(login).toContain('from "../sessions.js"')
            expect(refresh).toContain("from '../sessions.js'")
            expect(middleware).toContain("const established  =")
            expect(middleware).toContain("/* request principal */")

            for (const relative of UNCHANGED) {
              const [actual, original] = yield* Effect.all([
                readUtf8(root, relative),
                readUtf8(fixturePath, relative),
              ])
              expect(actual).toBe(original)
            }
            const second = yield* Recipe.run(positionalToOptions, input)
            expect(second.edits).toHaveLength(0)
          }),
        { fixture },
      ),
  )
})
