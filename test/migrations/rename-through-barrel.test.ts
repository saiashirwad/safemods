import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { renameThroughBarrel } from "../../examples/rename-through-barrel.ts"
import { layer as nodeLayer, workspaceLayerNode } from "../../src/Node.ts"
import * as Recipe from "../../src/Recipe.ts"
import { withFixture } from "../utils/declarative-fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { workspaceDefinition } from "../utils/domain.ts"

const fixturePath = fileURLToPath(
  new URL("../../fixtures/migrations/rename-through-barrel/", import.meta.url),
)

const file = (lines: ReadonlyArray<string>) => lines.join("\n") + "\n"

const readSource = (root: string, relative: string) =>
  Effect.tryPromise(() => Fs.readFile(Path.join(root, relative), "utf8"))

const afterStore = file([
  'import { AccountNotFound, type Account } from "./account.js"',
  "",
  "const accounts: ReadonlyArray<Account> = [",
  "  {",
  '    id: "acc_1001",',
  '    email: "billing@example.com",',
  '    status: "active",',
  '    openedAt: new Date("2024-01-15T00:00:00.000Z"),',
  "  },",
  "  {",
  '    id: "acc_1002",',
  '    email: "ops@example.com",',
  '    status: "suspended",',
  '    openedAt: new Date("2024-03-02T00:00:00.000Z"),',
  "  },",
  "]",
  "",
  "/** Look up a customer account by id. Missing rows are not-found, not empty. */",
  "export function findAccount(accountId: string): Account {",
  "  const account = accounts.find((row) => row.id === accountId)",
  "  if (account === undefined) {",
  "    throw new AccountNotFound(accountId)",
  "  }",
  "  return account",
  "}",
  "",
  "export function listActiveAccounts(): ReadonlyArray<Account> {",
  '  return accounts.filter((account) => account.status === "active")',
  "}",
  "",
  "export function requireActiveAccount(accountId: string): Account {",
  "  // Runbooks still say loadAccount; leave this sentence alone.",
  "  const account = findAccount(accountId)",
  '  if (account.status !== "active") {',
  "    throw new Error(`Account ${accountId} is ${account.status}`)",
  "  }",
  "  return account",
  "}",
  "",
  'export const accountLookupEvent = "loadAccount"',
])

const afterBarrel = file([
  'export type { Account, AccountStatus } from "./account.js"',
  'export { AccountNotFound, isBillable } from "./account.js"',
  'export { findAccount, listActiveAccounts, requireActiveAccount } from "./store.js"',
  'export { findAccount as lookupAccount } from "./store.js"',
])

const afterInvoices = file([
  "import { /* billing still binds the public name */ findAccount as fetchAccount } from '../accounts/store.js'",
  'import type { Account } from "../accounts/account.js"',
  "",
  "export interface Invoice {",
  "  readonly id: string",
  "  readonly accountId: string",
  "  readonly cents: number",
  "}",
  "",
  "export function invoiceOwner(invoice: Invoice): Account {",
  "  // Unusual spacing is a source-fidelity sentinel.",
  "  const account  = fetchAccount(/* keep the billed-account comment */ invoice.accountId)",
  "  return account",
  "}",
  "",
  "export function invoiceTotal(invoices: ReadonlyArray<Invoice>): number {",
  "  return invoices.reduce((sum, invoice) => sum + invoice.cents, 0)",
  "}",
  "",
  "export function describeInvoice(invoice: Invoice): string {",
  "  const owner = fetchAccount(invoice.accountId)",
  "  return `${invoice.id} billed to ${owner.email}`",
  "}",
])

const afterHandler = file([
  'import { findAccount } from "../accounts/index.js"',
  'import type { Account } from "../accounts/account.js"',
  "",
  "export interface AccountRequest {",
  "  readonly accountId: string",
  "}",
  "",
  "export interface AccountResponse {",
  "  readonly id: string",
  "  readonly email: string",
  '  readonly status: Account["status"]',
  "}",
  "",
  "export const handleAccountShow  = (request: AccountRequest): Account =>",
  "  findAccount(request.accountId)",
  "",
  "export function serializeAccount(accountId: string): AccountResponse {",
  "  const account = findAccount(accountId)",
  "  return { id: account.id, email: account.email, status: account.status }",
  "}",
])

const unchangedAccount = file([
  'export type AccountStatus = "active" | "suspended" | "closed"',
  "",
  "export interface Account {",
  "  readonly id: string",
  "  readonly email: string",
  "  readonly status: AccountStatus",
  "  readonly openedAt: Date",
  "}",
  "",
  "export class AccountNotFound extends Error {",
  '  readonly _tag = "AccountNotFound"',
  "",
  "  constructor(readonly accountId: string) {",
  "    super(`Account ${accountId} was not found`)",
  '    this.name = "AccountNotFound"',
  "  }",
  "}",
  "",
  'export const isBillable = (account: Account): boolean => account.status === "active"',
])

const unchangedSession = file([
  'import { lookupAccount } from "../accounts/index.js"',
  "",
  "export interface Session {",
  "  readonly accountId: string",
  "  readonly email: string",
  "}",
  "",
  "export function restoreSession(accountId: string): Session {",
  "  const account = lookupAccount(accountId)",
  "  return { accountId: account.id, email: account.email }",
  "}",
])

const unchangedDirectory = file([
  "export interface DirectoryEntry {",
  "  readonly userId: string",
  "  readonly displayName: string",
  "  readonly email: string",
  "}",
  "",
  "const directory: ReadonlyArray<DirectoryEntry> = [",
  '  { userId: "usr_ada", displayName: "Ada Lovelace", email: "ada@example.com" },',
  '  { userId: "usr_grace", displayName: "Grace Hopper", email: "grace@example.com" },',
  "]",
  "",
  "/** Directory lookup. This is not the accounts-module loadAccount. */",
  "export function loadAccount(userId: string): DirectoryEntry {",
  "  const entry = directory.find((row) => row.userId === userId)",
  "  if (entry === undefined) {",
  "    throw new Error(`User ${userId} is not in the directory`)",
  "  }",
  "  return entry",
  "}",
  "",
  "export function displayNameFor(userId: string): string {",
  "  return loadAccount(userId).displayName",
  "}",
])

const unchangedMetrics = file([
  "export interface AuditCounters {",
  "  readonly loginAttempts: number",
  "  readonly failedLookups: number",
  "}",
  "",
  "export const emptyCounters: AuditCounters = {",
  "  loginAttempts: 0,",
  "  failedLookups: 0,",
  "}",
  "",
  "// Deliberate baseline error: a stored lag metric was typed as a string and never migrated.",
  "export const auditLagSeconds: string = 15",
  "",
  "export function recordFailure(counters: AuditCounters): AuditCounters {",
  "  return {",
  "    loginAttempts: counters.loginAttempts,",
  "    failedLookups: counters.failedLookups + 1,",
  "  }",
  "}",
])

describe("rename-through-barrel", () => {
  effect(
    "renames loadAccount through barrels and aliases without touching a different loadAccount",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const { plan, verified } = yield* executeRecipe(renameThroughBarrel, undefined)

            expect(plan.recipe.name).toBe("rename-through-barrel")
            expect(plan.measurements.matches).toBe(8)
            expect(verified.preview.files).toHaveLength(4)
            expect(verified.diagnosticDiff.introduced).toHaveLength(0)

            expect(yield* readSource(root, "src/accounts/store.ts")).toBe(afterStore)
            expect(yield* readSource(root, "src/accounts/index.ts")).toBe(afterBarrel)
            expect(yield* readSource(root, "src/billing/invoices.ts")).toBe(afterInvoices)
            expect(yield* readSource(root, "src/http/account-handler.ts")).toBe(afterHandler)

            expect(yield* readSource(root, "src/accounts/account.ts")).toBe(unchangedAccount)
            expect(yield* readSource(root, "src/auth/session.ts")).toBe(unchangedSession)
            expect(yield* readSource(root, "src/users/directory.ts")).toBe(unchangedDirectory)
            expect(yield* readSource(root, "src/audit/metrics.ts")).toBe(unchangedMetrics)

            const freshWorkspaceLayer = workspaceLayerNode(
              workspaceDefinition({ projects: [app] }),
              { cwd: root },
            )
            const second = yield* Recipe.run(renameThroughBarrel, undefined).pipe(
              Effect.provide(Layer.merge(freshWorkspaceLayer, nodeLayer)),
            )
            expect(second.edits).toHaveLength(0)
            expect(second.measurements.matches).toBe(0)
          }),
        { fixturePath },
      ),
    60_000,
  )
})
