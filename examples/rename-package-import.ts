import { Effect } from "effect"
import { and, or, refineDefinedKey } from "is-kit"
import type { StringLiteral } from "typescript/unstable/ast"
import {
  isExportDeclaration,
  isImportDeclaration,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const FROM_PACKAGE = "@acme/legacy-client"
const TO_PACKAGE = "@acme/client"

const isModuleReference = and(
  or(isImportDeclaration, isExportDeclaration),
  refineDefinedKey("moduleSpecifier", isStringLiteral),
)

const rewriteSpecifier = (specifier: StringLiteral): string => {
  const quote = specifier.getText().startsWith("'") ? "'" : '"'
  return `${quote}${TO_PACKAGE}${quote}`
}

export const renamePackageImport = Recipe.define("rename-package-import", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = snapshot.projects[0]
      if (project === undefined) {
        return Draft.empty
      }
      const references = yield* Query.nodes(project, isModuleReference).pipe(
        Query.filter(({ value }) => value.moduleSpecifier.text === FROM_PACKAGE),
        Query.collect,
      )

      return Draft.concat(
        ...references.map(({ project, value }) =>
          Draft.replace(project, value.moduleSpecifier, rewriteSpecifier(value.moduleSpecifier)),
        ),
      )
    }),
})
