import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { layer as nodeLayer } from "../src/Node.ts"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as Application from "../src/Application.ts"
import * as Draft from "../src/Draft/index.ts"
import * as Query from "../src/Query/index.ts"
import * as Recipe from "../src/Recipe.ts"
import * as Verification from "../src/Verification/index.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"

interface ForgedPlanCapability extends Partial<Verification.VerifiedPlan> {
  readonly [key: PropertyKey]:
    | Verification.VerifiedPlan["plan"]
    | Verification.PlanPreview
    | Verification.DiagnosticDiff
    | { readonly VerifiedPlan: "VerifiedPlan" }
}

const exists = (fileName: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    Fs.stat(fileName).then(
      () => true,
      () => false,
    ),
  )

describe("Node application capability and staleness checks", () => {
  effect("rejects a symlinked project subdirectory that escapes the workspace", () =>
    withFixture((root, app) =>
      Effect.gen(function* () {
        const outside = yield* Effect.promise(() =>
          Fs.mkdtemp(Path.join(Path.dirname(root), "safemods-outside-")),
        )
        const link = Path.join(root, "src", "escape")
        yield* Effect.promise(() => Fs.symlink(outside, link, "dir"))
        const recipe = Recipe.define("symlink-escape", {
          version: "1.0.0",
          policies: { diagnostics: "allow-new-errors" },
          run: () =>
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              return yield* Draft.files.create(
                project,
                "src/escape/outside.ts",
                "export const escaped = true;\n",
              )
            }),
        })
        const plan = yield* Recipe.run(recipe, undefined)
        const verified = yield* Verification.verify(plan, recipe, undefined)
        const result = yield* Application.applyVerifiedPlan(verified).pipe(
          Effect.provide(nodeLayer),
          Effect.result,
        )
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure") expect(result.failure._tag).toBe("ApplicationFailure")
        expect(yield* exists(Path.join(outside, "outside.ts"))).toBe(false)
        yield* Effect.promise(() => Fs.rm(outside, { recursive: true, force: true }))
      }),
    ),
  )

  effect("rejects forgeries and copied verified-plan capabilities", () =>
    withFixture((root, app) =>
      Effect.gen(function* () {
        const contents = "export const created = true;\n"
        const recipe = Recipe.define("forged-apply", {
          version: "1.0.0",
          policies: { diagnostics: "allow-new-errors" },
          run: () =>
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              return yield* Draft.files.create(project, "src/created.ts", contents)
            }),
        })
        const plan = yield* Recipe.run(recipe, undefined)
        const verified = yield* Verification.verify(plan, recipe, undefined)
        const spreadForgery = { ...verified }
        const clonedPreview = structuredClone(verified.preview)
        const clonedForgery: ForgedPlanCapability = {
          plan: structuredClone(verified.plan),
          preview: {
            ...clonedPreview,
            files: clonedPreview.files.map((file) =>
              file.after.exists
                ? {
                    ...file,
                    after: { exists: true as const, text: "forged-bytes\n", hash: file.after.hash },
                  }
                : file,
            ),
          },
          diagnosticDiff: structuredClone(verified.diagnosticDiff),
        }
        const clonedResult = yield* Application.applyVerifiedPlan(
          // SAFETY: the test applies a cloned capability without its process-local brand.
          clonedForgery as Verification.VerifiedPlan,
        ).pipe(Effect.provide(nodeLayer), Effect.result)
        const spreadResult = yield* Application.applyVerifiedPlan(spreadForgery).pipe(
          Effect.provide(nodeLayer),
          Effect.result,
        )
        expect(clonedResult._tag).toBe("Failure")
        expect(spreadResult._tag).toBe("Failure")
        expect(yield* exists(Path.join(root, "src/created.ts"))).toBe(false)
      }),
    ),
  )

  effect("rechecks source hashes at application instead of trusting a later disk edit", () =>
    withFixture((root, app) =>
      Effect.gen(function* () {
        const recipe = Recipe.define("stale-apply", {
          version: "1.0.0",
          policies: { diagnostics: "allow-new-errors" },
          run: () =>
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              const [declaration] = yield* Query.imports(project).pipe(
                Query.within("src/consumer.ts"),
                Query.collect,
              )
              return yield* Draft.insertBefore(
                project,
                declaration!.value,
                "// touched by stale-apply\n",
              )
            }),
        })
        const plan = yield* Recipe.run(recipe, undefined)
        const verified = yield* Verification.verify(plan, recipe, undefined)
        const original = yield* Effect.promise(() =>
          Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8"),
        )
        yield* Effect.promise(() => Fs.writeFile(Path.join(root, "src/consumer.ts"), "changed\n"))
        const result = yield* Application.applyVerifiedPlan(verified).pipe(
          Effect.provide(nodeLayer),
          Effect.result,
        )
        expect(result._tag).toBe("Failure")
        expect(
          yield* Effect.promise(() => Fs.readFile(Path.join(root, "src/consumer.ts"), "utf8")),
        ).toBe("changed\n")
        expect(original).not.toContain("changed\n")
      }),
    ),
  )
})
