import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { relativeJsExtensions } from "../../examples/relative-js-extensions.ts"
import { layer as nodeLayer, workspaceLayerNode } from "../../src/Node.ts"
import * as Recipe from "../../src/Recipe.ts"
import { withFixture } from "../utils/declarative-fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { workspaceDefinition } from "../utils/domain.ts"

const fixturePath = fileURLToPath(
  new URL("../../fixtures/migrations/relative-js-extensions/", import.meta.url),
)

const read = (root: string, relative: string) =>
  Effect.tryPromise(() => Fs.readFile(Path.join(root, relative), "utf8"))

describe("relative-js-extensions", () => {
  effect(
    "adds .js extensions to relative import specifiers and is a no-op on rerun",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const { plan, verified } = yield* executeRecipe(relativeJsExtensions, undefined)

            expect(plan.measurements.matches).toBe(14)
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
            expect(yield* read(root, "tsconfig.json")).toBe(
              yield* read(fixturePath, "tsconfig.json"),
            )
            expect(yield* read(root, "package.json")).toBe(yield* read(fixturePath, "package.json"))

            const ledger = yield* read(root, "src/billing/ledger.ts")
            expect(ledger).toContain('export const lastReconciledAt: Date = "not-a-date"')
            expect(ledger).toContain('from "./invoices.js"')

            const logger = yield* read(root, "src/telemetry/logger.ts")
            expect(logger).toContain('from "node:util"')

            const freshWorkspaceLayer = workspaceLayerNode(
              workspaceDefinition({ projects: [app] }),
              { cwd: root },
            )
            const second = yield* Recipe.run(relativeJsExtensions, undefined).pipe(
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
