import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { layer as nodeLayer, workspaceLayerNode } from "../../src/Node.ts"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { defaultToNamed, type DefaultToNamedInput } from "../../examples/default-to-named.ts"
import * as Recipe from "../../src/Recipe.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { withFixture } from "../utils/declarative-fixture.ts"

const fixturePath = fileURLToPath(
  new URL("../../fixtures/migrations/default-to-named/", import.meta.url),
)

describe("default-to-named", () => {
  effect(
    "converts authenticate from a default export to a named export",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const input: DefaultToNamedInput = {
              project: app,
              declarationFile: "src/auth/authenticate.ts",
              exportName: "authenticate",
            }

            const { plan, verified } = yield* executeRecipe(defaultToNamed, input)

            expect(plan.measurements.matches).toBe(4)
            expect(plan.edits).toHaveLength(4)
            expect(verified.diagnosticDiff.introduced).toHaveLength(0)

            const read = (relative: string) =>
              Effect.tryPromise(() => Fs.readFile(Path.join(root, relative), "utf8"))
            const original = (relative: string) =>
              Effect.tryPromise(() => Fs.readFile(Path.join(fixturePath, relative), "utf8"))

            const authenticate = yield* read("src/auth/authenticate.ts")
            expect(authenticate).toContain("export function authenticate")
            expect(authenticate).not.toContain("export default function authenticate")
            expect(authenticate).toContain("Keep this JSDoc attached to the export.")

            const barrel = yield* read("src/auth/index.ts")
            expect(barrel).toContain('export { authenticate } from "./authenticate.js"')
            expect(barrel).not.toContain("default as authenticate")

            const account = yield* read("src/users/account.ts")
            expect(account).toContain(
              'import { authenticate, AUTH_SCHEME } from "../auth/authenticate.js"',
            )
            expect(account).not.toContain("import authenticate,")

            const router = yield* read("src/http/router.ts")
            expect(router).toContain(
              "import /* keep this comment */ { authenticate as signIn } from '../auth/authenticate.js'",
            )
            expect(router).toContain(
              'import renderInvoice, { type Invoice } from "../billing/invoice.js"',
            )
            expect(router).toContain("const session  = signIn(credentials)")

            expect(yield* read("src/auth/session.ts")).toBe(yield* original("src/auth/session.ts"))
            expect(yield* read("src/billing/invoice.ts")).toBe(
              yield* original("src/billing/invoice.ts"),
            )
            expect(yield* read("src/http/middleware.ts")).toBe(
              yield* original("src/http/middleware.ts"),
            )
            expect(yield* read("src/config.ts")).toBe(yield* original("src/config.ts"))
            expect(yield* read("src/diagnostics.ts")).toBe(yield* original("src/diagnostics.ts"))
            expect(yield* read("src/diagnostics.ts")).toContain(
              "export const servicePort: string = 8080",
            )

            const freshWorkspaceLayer = workspaceLayerNode({ projects: [app] }, { cwd: root })
            const second = yield* Recipe.run(defaultToNamed, input).pipe(
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
