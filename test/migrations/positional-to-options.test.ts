import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { positionalToOptions } from "../../examples/positional-to-options.ts"
import { layer as nodeLayer, workspaceLayerNode } from "../../src/Node.ts"
import * as Recipe from "../../src/Recipe.ts"
import { withFixture } from "../utils/declarative-fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"

const fixtureDir = fileURLToPath(
  new URL("../../fixtures/migrations/positional-to-options/", import.meta.url),
)

const readUtf8 = (root: string, relative: string) =>
  Effect.tryPromise(() => Fs.readFile(Path.join(root, relative), "utf8"))

const UNCHANGED = [
  "tsconfig.json",
  "src/sessions.ts",
  "src/index.ts",
  "src/http/request.ts",
  "src/billing/invoices.ts",
  "src/users/directory.ts",
  "src/diagnostics/legacy-quota.ts",
] as const

describe("positional-to-options", () => {
  effect(
    "wraps canonical positional createSession calls into an options object",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const input = { project: app }
            const { plan, verified, receipt } = yield* executeRecipe(positionalToOptions, input)

            expect(plan.recipe.name).toBe("positional-to-options")
            expect(plan.measurements.matches).toBe(4)
            expect(verified.diagnosticDiff.introduced).toEqual([])
            expect(
              verified.diagnosticDiff.unchanged.some((diagnostic) => diagnostic.code === 2322),
            ).toBe(true)
            expect(new Set(verified.preview.files.map((file) => file.fileName))).toEqual(
              new Set(["src/auth/login.ts", "src/auth/refresh.ts", "src/http/middleware.ts"]),
            )
            expect(receipt.outputs).toHaveLength(3)

            const originalLogin = yield* readUtf8(fixtureDir, "src/auth/login.ts")
            const originalRefresh = yield* readUtf8(fixtureDir, "src/auth/refresh.ts")
            const originalMiddleware = yield* readUtf8(fixtureDir, "src/http/middleware.ts")
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
                "openSession({ userId: userId, ttlSeconds: ttlSeconds })",
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
                readUtf8(fixtureDir, relative),
              ])
              expect(actual).toBe(original)
            }

            const freshWorkspaceLayer = workspaceLayerNode({ projects: [app] }, { cwd: root })
            const second = yield* Recipe.run(positionalToOptions, input).pipe(
              Effect.provide(Layer.merge(freshWorkspaceLayer, nodeLayer)),
            )
            expect(second.edits).toHaveLength(0)
            expect(second.measurements.matches).toBe(0)
          }),
        { fixturePath: fixtureDir },
      ),
    60_000,
  )
})
