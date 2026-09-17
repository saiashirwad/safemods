import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { relativeJsExtensions } from "../../examples/relative-js-extensions.ts"
import * as Recipe from "../../src/Recipe.ts"
import { fixturePath as fixtureDirectory, withFixture } from "../utils/fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"

const fixture = "migrations/relative-js-extensions"
const fixturePath = fixtureDirectory(fixture)

const read = (root: string, relative: string) =>
  Effect.tryPromise(() => Fs.readFile(Path.join(root, relative), "utf8"))

describe("relative-js-extensions", () => {
  effect("adds .js extensions to relative import specifiers and is a no-op on rerun", () =>
    withFixture(
      (root) =>
        Effect.gen(function* () {
          const { plan, verified } = yield* executeRecipe(relativeJsExtensions, undefined)

          expect(plan.edits).toHaveLength(14)
          expect(verified.preview.files).toHaveLength(6)
          expect(verified.diagnosticDiff.introduced).toHaveLength(0)
          expect(
            verified.diagnosticDiff.unchanged.some((diagnostic) => diagnostic.code === 2322),
          ).toBe(true)

          const index = yield* read(root, "src/index.ts")
          expect(index).toContain('from "./http/server.js"')
          expect(index).toContain('from "./auth/index.js"')
          expect(index).toContain('from "./auth/session.js"')
          expect(index).toContain('from "./telemetry/logger.js"')
          expect(index).toContain('import("./billing/ledger.js")')
          expect(index).toContain("export const startBillingApi  =")

          const server = yield* read(root, "src/http/server.ts")
          expect(server).toContain("from './routes.js'")
          expect(server).toContain("/* keep this comment */")
          expect(server).toContain('from "../auth/session.js"')
          expect(server).toContain('from "../users/directory.js"')
          expect(server).toContain("export const listen  =")

          const routes = yield* read(root, "src/http/routes.ts")
          expect(routes).toContain("verifySession as requireSession")
          expect(routes).toContain('from "../auth/session.js"')
          expect(routes).toContain('from "../users/directory.js"')
          expect(routes).toContain('from "../billing/invoices.js"')

          const authIndex = yield* read(root, "src/auth/index.ts")
          expect(authIndex).toContain('from "./session.js"')
          expect(authIndex).toContain("export type { Session }")

          const invoices = yield* read(root, "src/billing/invoices.ts")
          expect(invoices).toContain("from '../users/directory.js'")

          const directory = yield* read(root, "src/users/directory.ts")
          expect(directory).toContain('from "./profile.js"')
          expect(directory).toContain('from "../auth/session.js"')
          expect(directory).not.toContain("../auth/session.ts")

          expect(yield* read(root, "src/telemetry/logger.ts")).toBe(
            yield* read(fixturePath, "src/telemetry/logger.ts"),
          )
          expect(yield* read(root, "src/auth/session.ts")).toBe(
            yield* read(fixturePath, "src/auth/session.ts"),
          )
          expect(yield* read(root, "src/users/profile.ts")).toBe(
            yield* read(fixturePath, "src/users/profile.ts"),
          )
          expect(yield* read(root, "src/billing/ledger.ts")).toBe(
            yield* read(fixturePath, "src/billing/ledger.ts"),
          )
          expect(yield* read(root, "tsconfig.json")).toBe(yield* read(fixturePath, "tsconfig.json"))
          expect(yield* read(root, "package.json")).toBe(yield* read(fixturePath, "package.json"))

          const ledger = yield* read(root, "src/billing/ledger.ts")
          expect(ledger).toContain('export const lastReconciledAt: Date = "not-a-date"')
          expect(ledger).toContain('from "./invoices.js"')

          const logger = yield* read(root, "src/telemetry/logger.ts")
          expect(logger).toContain('from "node:util"')
          const second = yield* Recipe.run(relativeJsExtensions, undefined)
          expect(second.edits).toHaveLength(0)
        }),
      { fixture },
    ),
  )
})
