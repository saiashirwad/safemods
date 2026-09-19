import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { splitModule, type SplitModuleInput } from "../../examples/split-module.ts"
import * as Recipe from "../../src/Recipe.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { withFixture } from "../utils/fixture.ts"

const fixture = "migrations/split-module"

const read = (root: string, relative: string) =>
  Effect.tryPromise(() => Fs.readFile(Path.join(root, relative), "utf8"))

const exists = (root: string, relative: string) =>
  Effect.tryPromise(() =>
    Fs.access(Path.join(root, relative)).then(
      () => true,
      () => false,
    ),
  )

describe("split-module", () => {
  effect("derives the split from the source and keeps everything else in its consumers", () =>
    withFixture(
      (root, project) =>
        Effect.gen(function* () {
          const { verified } = yield* executeRecipe(splitModule, { project })
          expect(verified.diagnosticDiff.introduced).toHaveLength(0)

          expect(yield* read(root, "src/accounts/model.ts")).toContain("export interface Plan {")
          const service = yield* read(root, "src/accounts/service.ts")
          expect(service).toContain('import type { Account, AccountId } from "./model.js"')
          expect(service).toContain("export const countAccounts = (): number => accounts.size")
          expect(yield* read(root, "src/accounts/index.ts")).toBe(
            'export type { Account, AccountId, Plan } from "./model.js"\n' +
              'export { findAccount, saveAccount, countAccounts } from "./service.js"\n',
          )
          expect(yield* read(root, "src/reports/usage.ts")).toBe(
            [
              "import type { Plan as AccountPlan } from '../accounts/model.js';",
              "import { countAccounts } from '../accounts/service.js';",
              "",
              "export const usage = (plan: AccountPlan): string => `${plan.name}: ${countAccounts()}`",
              "",
            ].join("\n"),
          )
        }),
      {
        fixture,
        files: {
          "src/accounts.ts": [
            "export interface Account {",
            "  readonly id: string",
            "  readonly email: string",
            "}",
            "",
            'export type AccountId = Account["id"]',
            "",
            "export interface Plan {",
            "  readonly name: string",
            "}",
            "",
            "const accounts = new Map<AccountId, Account>()",
            "",
            "export const findAccount = (id: AccountId): Account | undefined => accounts.get(id)",
            "",
            "export const saveAccount = (account: Account): void => {",
            "  accounts.set(account.id, account)",
            "}",
            "",
            "export const countAccounts = (): number => accounts.size",
            "",
          ].join("\n"),
          "src/reports/usage.ts": [
            "import { type Plan as AccountPlan, countAccounts } from '../accounts.js';",
            "",
            "export const usage = (plan: AccountPlan): string => `${plan.name}: ${countAccounts()}`",
            "",
          ].join("\n"),
        },
      },
    ),
  )

  effect("splits a mixed module and coordinates its consumers", () =>
    withFixture(
      (root, project) =>
        Effect.gen(function* () {
          const input: SplitModuleInput = { project }
          const { plan, verified } = yield* executeRecipe(splitModule, input)

          expect(plan.edits).toHaveLength(4)
          expect(plan.fileOperations).toHaveLength(4)
          expect(verified.diagnosticDiff.introduced).toHaveLength(0)
          expect(verified.diagnosticDiff.resolved).toHaveLength(0)

          expect(yield* exists(root, "src/accounts.ts")).toBe(false)
          expect(yield* read(root, "src/accounts/model.ts")).toContain("export type AccountId")
          expect(yield* read(root, "src/accounts/service.ts")).toContain(
            'import type { Account, AccountId } from "./model.js"',
          )
          expect(yield* read(root, "src/accounts/index.ts")).toBe(
            'export type { Account, AccountId } from "./model.js"\n' +
              'export { findAccount, saveAccount } from "./service.js"\n',
          )

          const handler = yield* read(root, "src/http/account-handler.ts")
          expect(handler).toContain(
            'import type { Account, AccountId } from "../accounts/model.js"',
          )
          expect(handler).toContain(
            'import { findAccount, saveAccount } from "../accounts/service.js"',
          )

          expect(yield* read(root, "src/audit/account-event.ts")).toContain(
            'import type { Account, AccountId } from "../accounts/model.js"',
          )
          expect(yield* read(root, "src/public-api.ts")).toContain(
            'export { findAccount, saveAccount } from "./accounts/service.js"',
          )
          expect(yield* read(root, "src/diagnostics/baseline.ts")).toContain(
            "export const retryLimit: string = 3",
          )

          const second = yield* Recipe.run(splitModule, input)
          expect(second.edits).toHaveLength(0)
          expect(second.fileOperations).toHaveLength(0)
        }),
      { fixture },
    ),
  )
})
