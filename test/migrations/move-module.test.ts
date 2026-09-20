import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { moveModule, type MoveModuleInput } from "../../examples/move-module.ts"
import * as Recipe from "../../src/Recipe.ts"
import { withFixture } from "../utils/fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { projectPath } from "../utils/domain.ts"

const fixture = "migrations/move-module"

describe("move-module", () => {
  effect(
    "asks the compiler which specifiers reach the moved file, whatever its extension",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const input: MoveModuleInput = {
              project: app,
              from: projectPath("src/tools/clock.mts"),
              to: projectPath("src/shared/clock.mts"),
            }
            const { verified } = yield* executeRecipe(moveModule, input)
            expect(verified.diagnosticDiff.introduced).toHaveLength(0)

            const user = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/tools/user.mts"), "utf8")
            )
            expect(user).toContain('from "../shared/clock.mjs"')
            expect(user).toContain('from "./clock-utils.mjs"')
          }),
        {
          fixture,
          files: {
            "src/tools/clock.mts": "export const now = (): number => Date.now()\n",
            "src/tools/clock-utils.mts": "export const later = (ms: number): number => ms + 1\n",
            "src/tools/user.mts": [
              'import { now } from "./clock.mjs"',
              'import { later } from "./clock-utils.mjs"',
              "export const soon = later(now())",
              "",
            ].join("\n"),
          },
        },
      ),
  )

  effect("moves src/users/account.ts and rewrites relative importers", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          const input: MoveModuleInput = {
            project: app,
            from: projectPath("src/users/account.ts"),
            to: projectPath("src/identity/account.ts"),
          }

          const { plan, verified } = yield* executeRecipe(moveModule, input)

          expect(plan.edits).toHaveLength(6)
          expect(plan.fileOperations).toHaveLength(1)
          expect(plan.fileOperations[0]).toMatchObject({
            kind: "move",
            fileName: "src/users/account.ts",
            toFileName: "src/identity/account.ts",
          })
          expect(verified.diagnosticDiff.introduced).toHaveLength(0)

          const sourceExists = yield* Effect.tryPromise(() =>
            Fs.access(Path.join(root, "src/users/account.ts")).then(
              () => true,
              () => false,
            )
          )
          expect(sourceExists).toBe(false)

          const moved = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/identity/account.ts"), "utf8")
          )
          expect(moved).toContain("export const createAccount")
          expect(moved).toContain('from "../billing/invoices.js"')

          const barrel = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/users/index.ts"), "utf8")
          )
          expect(barrel).toContain("Public users surface")
          expect(barrel).toContain('from "../identity/account.js"')
          expect(barrel).not.toContain('from "./account.js"')

          const session = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/identity/session.ts"), "utf8")
          )
          expect(session).toContain("from './account.js'")
          expect(session).not.toContain("../users/account")

          const handlers = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/http/handlers.ts"), "utf8")
          )
          expect(handlers).toContain("/* keep this comment */")
          expect(handlers).toContain("createAccount as provisionAccount")
          expect(handlers).toContain("export const register  =")
          expect(handlers).toContain('from "../identity/account.js"')

          const lazyAccount = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/http/lazy-account.ts"), "utf8")
          )
          expect(lazyAccount).toContain('typeof import("../identity/account.js")')
          expect(lazyAccount).toContain('import("../identity/account.js")')
          expect(lazyAccount).not.toContain("../users/account")

          const billingAccount = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/billing/account.ts"), "utf8")
          )
          expect(billingAccount).toContain("export interface LedgerAccount")
          expect(billingAccount).not.toContain("identity")

          const invoices = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/billing/invoices.ts"), "utf8")
          )
          expect(invoices).toContain('from "./account.js"')

          const login = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/auth/login.ts"), "utf8")
          )
          expect(login).toContain('from "../users/index.js"')

          const router = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/http/router.ts"), "utf8")
          )
          expect(router).toContain('from "./handlers.js"')
          expect(router).toContain('from "../auth/login.js"')

          const baseline = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/diagnostics/baseline.ts"), "utf8")
          )
          expect(baseline).toContain("severity: 1")
          const second = yield* Recipe.run(moveModule, input)
          expect(second.edits).toHaveLength(0)
          expect(second.fileOperations).toHaveLength(0)
        }),
      { fixture },
    ))
})
