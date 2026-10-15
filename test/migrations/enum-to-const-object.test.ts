import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import {
  enumToConstObject,
  type EnumToConstObjectInput,
} from "../../examples/enum-to-const-object.ts"
import { proposalOf } from "../utils/execute-recipe.ts"
import { expectMigration } from "../utils/expect-migration.ts"
import { withFixture } from "../utils/fixture.ts"
import { workspacePath } from "../utils/domain.ts"

const fixture = "migrations/enum-to-const-object"

const inputFor = (project: EnumToConstObjectInput["project"]): EnumToConstObjectInput => ({
  project,
  declarationFile: workspacePath("src/status.ts"),
  enumName: "Status",
})

describe("enum-to-const-object", () => {
  effect("preserves string enum type and value uses", () =>
    Effect.gen(function* () {
      const { verified } = yield* expectMigration(enumToConstObject, fixture, inputFor)
      expect(verified.diagnosticDiff.introduced).toHaveLength(0)
    }))

  effect("ignores a same-named enum that is a different symbol", () =>
    Effect.gen(function* () {
      const { verified } = yield* expectMigration(
        enumToConstObject,
        "migration-cases/enum-to-const-object-same-name",
        inputFor,
      )
      expect(verified.preview.files.map((file) => file.fileName)).toEqual(["src/status.ts"])
    }))

  effect("rejects numeric, computed, and merged enums", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise(() =>
            Fs.writeFile(
              Path.join(root, "src/unsupported.ts"),
              'enum Numeric { A = 1 }\nconst value = "x"\nenum Computed { A = value }\nenum Merged { A = "a" }\nenum Merged { B = "b" }\n',
            )
          )
          for (const enumName of ["Numeric", "Computed", "Merged"]) {
            const failure = yield* proposalOf(enumToConstObject, {
              project: app,
              declarationFile: workspacePath("src/unsupported.ts"),
              enumName,
            }).pipe(Effect.flip)
            expect(failure).toMatchObject({
              _tag: "UnsupportedEnum",
              reasons: expect.arrayContaining([
                enumName === "Merged" ?
                  "merged enum declarations are unsupported" :
                  "numeric and computed enum members are unsupported",
              ]),
            })
          }
        }),
      { fixture },
    ))
})
