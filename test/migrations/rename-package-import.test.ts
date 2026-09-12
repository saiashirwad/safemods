import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { renamePackageImport } from "../../examples/rename-package-import.ts"
import { layer as nodeLayer, workspaceLayerNode } from "../../src/Node.ts"
import * as Recipe from "../../src/Recipe.ts"
import { withFixture } from "../utils/declarative-fixture.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { workspaceDefinition } from "../utils/domain.ts"

const fixturePath = fileURLToPath(
  new URL("../../fixtures/migrations/rename-package-import/", import.meta.url),
)

const read = (root: string, relativePath: string) =>
  Effect.tryPromise(() => Fs.readFile(Path.join(root, relativePath), "utf8"))

describe("rename-package-import", () => {
  effect(
    "rewrites @acme/legacy-client specifiers and leaves other modules alone",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const { plan, verified } = yield* executeRecipe(renamePackageImport, undefined)

            expect(plan.measurements.matches).toBe(7)
            expect(plan.edits).toHaveLength(7)
            expect(verified.diagnosticDiff.introduced).toHaveLength(0)
            expect(
              verified.diagnosticDiff.unchanged.some((diagnostic) => diagnostic.code === 2322),
            ).toBe(true)

            const gateway = yield* read(root, "src/http/gateway.ts")
            expect(gateway).toContain(
              'import { createClient as connectAcme, type AcmeClient, type ClientConfig } from "@acme/client"',
            )
            expect(gateway).not.toContain("@acme/legacy-client")

            const session = yield* read(root, "src/auth/session.ts")
            expect(session).toContain("/* rotate keys before 2026-10-01 */")
            expect(session).toContain("export const  revokeForUser  =")
            expect(session).toContain('from "@acme/client"')
            expect(session).not.toContain("@acme/legacy-client")

            const invoices = yield* read(root, "src/billing/invoices.ts")
            expect(invoices).toContain("from '@acme/client'")
            expect(invoices).toContain('from "../audit/logger.js"')
            expect(invoices).not.toContain("@acme/legacy-client")

            const directory = yield* read(root, "src/users/directory.ts")
            expect(directory).toContain('import type { UserRecord } from "@acme/client"')
            expect(directory).toContain('from "../http/gateway.js"')
            expect(directory).not.toContain("@acme/legacy-client")

            const index = yield* read(root, "src/index.ts")
            expect(index).toContain(
              'export { createClient, type AcmeClient, type ClientConfig } from "@acme/client"',
            )
            expect(index).toContain('from "./http/gateway.js"')
            expect(index).not.toContain("@acme/legacy-client")

            const sdk = yield* read(root, "src/platform/sdk.ts")
            expect(sdk).toContain('export * from "@acme/client"')
            expect(sdk).toContain("from '@acme/client'")
            expect(sdk).not.toContain("@acme/legacy-client")

            expect(yield* read(root, "src/audit/logger.ts")).toBe(
              yield* read(fixturePath, "src/audit/logger.ts"),
            )
            expect(yield* read(root, "src/webhooks/inbox.ts")).toBe(
              yield* read(fixturePath, "src/webhooks/inbox.ts"),
            )
            expect(yield* read(root, "src/acme-modules.ts")).toBe(
              yield* read(fixturePath, "src/acme-modules.ts"),
            )
            expect(yield* read(root, "src/webhooks/inbox.ts")).toContain("deliveryId: 4012")

            const freshWorkspaceLayer = workspaceLayerNode(
              workspaceDefinition({ projects: [app] }),
              { cwd: root },
            )
            const second = yield* Recipe.run(renamePackageImport, undefined).pipe(
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
