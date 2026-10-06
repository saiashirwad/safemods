import { Effect } from "effect"
import { isStringLiteral } from "typescript/unstable/ast/is"
import * as Proposal from "../../src/Proposal.ts"
import * as Query from "../../src/Query.ts"
import * as Recipe from "../../src/Recipe.ts"
import type { ConfiguredProject } from "../../src/Workspace/index.ts"

export interface MigrateImportSourceInput {
  readonly project: ConfiguredProject.Type
  readonly from: string
  readonly to: string
}

export const migrateImportSource = Recipe.define("migrate-import-source", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (snapshot, input: MigrateImportSourceInput) =>
    Effect.gen(function* () {
      const project = yield* snapshot.project(input.project.id)

      const declarations = yield* Query.imports(project).pipe(
        Query.filter(
          ({ value }) =>
            isStringLiteral(value.moduleSpecifier) && value.moduleSpecifier.text === input.from,
        ),
      )

      return Proposal.concat(
        ...declarations.map(({ project, value }) => {
          const specifier = value.moduleSpecifier
          const quote = specifier.getText().startsWith("'") ? "'" : '"'
          return Proposal.replace(project, specifier, `${quote}${input.to}${quote}`)
        }),
      )
    }),
})
