import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { renameInterfaceProperty } from "../../examples/rename-interface-property.ts"
import * as Recipe from "../../src/Recipe.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { withFixture } from "../utils/fixture.ts"

const read = (root: string, file: string) =>
  Effect.tryPromise(() => Fs.readFile(Path.join(root, file), "utf8"))

describe("rename-interface-property", () => {
  effect("renames only semantic Account property references and reports computed access", () =>
    withFixture(
      (root) =>
        Effect.gen(function* () {
          const { plan, verified } = yield* executeRecipe(renameInterfaceProperty, undefined)

          expect(verified.diagnosticDiff.introduced).toHaveLength(0)
          expect(plan.unsupported).toHaveLength(1)
          expect(plan.unsupported[0]?.reason).toContain("Computed Account")
          const account = yield* read(root, "src/account.ts")
          expect(account).toContain("readonly label: string")
          expect(account).toContain('{ label: displayName, id: "acc_1" }')
          expect(account).toContain('{ label: "Grace", id: "acc_2" }')

          const consumer = yield* read(root, "src/consumer.ts")
          expect(consumer).toContain("account.label")
          expect(consumer).toContain("value?.label")
          expect(consumer).toContain("({ label: displayName }: Account) => displayName")
          expect(consumer).toContain("({ label: label }: Account) => label")
          expect(consumer).toContain("{ label: account.label, id: account.id }")
          expect(consumer).toContain('({ label: displayName, id: "acc_3" })')
          expect(consumer).toContain("unrelated.displayName")
          expect(consumer).toContain('["displayName"]')

          const second = yield* Recipe.run(renameInterfaceProperty, undefined)
          expect(second.edits).toHaveLength(0)
          expect(second.unsupported).toHaveLength(0)
        }),
      { fixture: "migrations/rename-interface-property" },
    ),
  )
})
