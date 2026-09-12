import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { moveModule, type MoveModuleInput } from "../../examples/move-module.ts"
import { layer as nodeLayer, workspaceLayerNode } from "../../src/Node.ts"
import * as Recipe from "../../src/Recipe.ts"
import { withFixture } from "../utils/declarative-fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"

const fixturePath = fileURLToPath(
  new URL("../../fixtures/migrations/move-module/", import.meta.url),
)

describe("move-module", () => {
  effect(
    "moves src/users/account.ts and rewrites relative importers",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const input: MoveModuleInput = {
              project: app,
              from: "src/users/account.ts",
              to: "src/identity/account.ts",
            }

            const { plan, verified } = yield* executeRecipe(moveModule, input)

            expect(plan.measurements.matches).toBe(5)
            expect(plan.edits).toHaveLength(4)
            expect(plan.fileOperations).toHaveLength(1)
            expect(plan.fileOperations[0]).toMatchObject({
              kind: "move",
              path: "src/users/account.ts",
              toPath: "src/identity/account.ts",
            })
            expect(verified.diagnosticDiff.introduced).toHaveLength(0)

            const gone = yield* Effect.tryPromise(() =>
              Fs.access(Path.join(root, "src/users/account.ts")).then(
                () => true,
                () => false,
              ),
            )
            expect(gone).toBe(false)

            const moved = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/identity/account.ts"), "utf8"),
            )
            expect(moved).toContain("export const createAccount")
            expect(moved).toContain('from "../billing/invoices.js"')

            const barrel = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/users/index.ts"), "utf8"),
            )
            expect(barrel).toContain("Public users surface")
            expect(barrel).toContain('from "../identity/account.js"')
            expect(barrel).not.toContain('from "./account.js"')

            const session = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/identity/session.ts"), "utf8"),
            )
            expect(session).toContain("from './account.js'")
            expect(session).not.toContain("../users/account")

            const handlers = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/http/handlers.ts"), "utf8"),
            )
            expect(handlers).toContain("/* keep this comment */")
            expect(handlers).toContain("createAccount as provisionAccount")
            expect(handlers).toContain("export const register  =")
            expect(handlers).toContain('from "../identity/account.js"')

            const billingAccount = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/billing/account.ts"), "utf8"),
            )
            expect(billingAccount).toContain("export interface LedgerAccount")
            expect(billingAccount).not.toContain("identity")

            const invoices = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/billing/invoices.ts"), "utf8"),
            )
            expect(invoices).toContain('from "./account.js"')

            const login = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/auth/login.ts"), "utf8"),
            )
            expect(login).toContain('from "../users/index.js"')

            const router = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/http/router.ts"), "utf8"),
            )
            expect(router).toContain('from "./handlers.js"')
            expect(router).toContain('from "../auth/login.js"')

            const baseline = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/diagnostics/baseline.ts"), "utf8"),
            )
            expect(baseline).toContain("severity: 1")

            const freshWorkspaceLayer = workspaceLayerNode({ projects: [app] }, { cwd: root })
            const second = yield* Recipe.run(moveModule, input).pipe(
              Effect.provide(Layer.merge(freshWorkspaceLayer, nodeLayer)),
            )
            expect(second.edits).toHaveLength(0)
            expect(second.fileOperations).toHaveLength(0)
            expect(second.measurements.matches).toBe(0)
          }),
        { fixturePath },
      ),
    60_000,
  )
})
