import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import {
  enumToConstObject,
  type EnumToConstObjectInput,
} from "../../examples/enum-to-const-object.ts"
import * as Recipe from "../../src/Recipe.ts"
import { executeRecipe } from "../utils/execute-recipe.ts"
import { withFixture } from "../utils/fixture.ts"
import { projectPath } from "../utils/domain.ts"

const fixture = "migrations/enum-to-const-object"

const inputFor = (project: EnumToConstObjectInput["project"]): EnumToConstObjectInput => ({
  project,
  declarationFile: projectPath("src/status.ts"),
  enumName: "Status",
})

describe("enum-to-const-object", () => {
  effect("preserves string enum type and value uses", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          const input = inputFor(app)
          const { plan, verified } = yield* executeRecipe(enumToConstObject, input)
          expect(plan.edits).toHaveLength(1)
          expect(verified.diagnosticDiff.introduced).toHaveLength(0)
          const text = yield* Effect.tryPromise(() =>
            Fs.readFile(Path.join(root, "src/status.ts"), "utf8"),
          )
          expect(text).toContain("export const Status = {")
          expect(text).toContain('Pending: "pending"')
          expect(text).toContain("export type Status = (typeof Status)[keyof typeof Status]")
          expect(text).toContain("The request has not started")
          expect(text).toContain("Kept stable for persisted records")
          expect((yield* Recipe.run(enumToConstObject, input)).edits).toHaveLength(0)
        }),
      { fixture },
    ),
  )

  effect("rejects numeric, computed, and merged enums", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise(() =>
            Fs.writeFile(
              Path.join(root, "src/unsupported.ts"),
              'enum Numeric { A = 1 }\nconst value = "x"\nenum Computed { A = value }\nenum Merged { A = "a" }\nenum Merged { B = "b" }\n',
            ),
          )
          for (const enumName of ["Numeric", "Computed", "Merged"]) {
            const failure = yield* Recipe.run(enumToConstObject, {
              project: app,
              declarationFile: projectPath("src/unsupported.ts"),
              enumName,
            }).pipe(Effect.flip)
            expect(failure).toMatchObject({
              _tag: "UnsupportedEnum",
              reasons: expect.arrayContaining([
                enumName === "Merged"
                  ? "merged enum declarations are unsupported"
                  : "numeric and computed enum members are unsupported",
              ]),
            })
          }
        }),
      { fixture },
    ),
  )
})
