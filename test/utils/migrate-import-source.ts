import { Effect } from "effect"
import { isStringLiteral } from "typescript/unstable/ast/is"
import * as Draft from "../../src/Draft.ts"
import * as Query from "../../src/Query.ts"
import * as Recipe from "../../src/Recipe.ts"
import { type ConfiguredProject, WorkspaceSnapshot } from "../../src/Workspace/index.ts"

export interface MigrateImportSourceInput {
  readonly project: ConfiguredProject.Type
  readonly from: string
  readonly to: string
}

export const migrateImportSource = Recipe.define("migrate-import-source", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: MigrateImportSourceInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project)

      const declarations = yield* Query.imports(project).pipe(
        Query.filter(
          ({ value }) =>
            isStringLiteral(value.moduleSpecifier) && value.moduleSpecifier.text === input.from,
        ),
        Query.collect,
      )

      return Draft.concat(
        ...declarations.map(({ project, value }) => {
          const specifier = value.moduleSpecifier
          const quote = specifier.getText().startsWith("'") ? "'" : '"'
          return Draft.replace(project, specifier, `${quote}${input.to}${quote}`)
        }),
      )
    }),
})
