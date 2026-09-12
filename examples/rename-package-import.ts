import { Effect } from "effect"
import { and, or, refineDefinedKey } from "is-kit"
import { SyntaxKind, type StringLiteral } from "typescript/unstable/ast"
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

const rewriteSpecifier = (specifier: StringLiteral) => {
  const quote = specifier.getText().startsWith("'") ? "'" : '"'
  return { node: specifier, text: `${quote}${TO_PACKAGE}${quote}` }
}

export const renamePackageImport = Recipe.define("rename-package-import", {
  version: "1.0.0",
  policies: { matchCount: { min: 1 }, idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const configured = snapshot.projects[0]
      if (configured === undefined) {
        return Draft.empty
      }
      const project = yield* snapshot.project(configured)

      const references = yield* Query.nodes(project, isModuleReference, [
        SyntaxKind.ImportDeclaration,
        SyntaxKind.ExportDeclaration,
      ]).pipe(
        Query.filter(({ value }) => value.moduleSpecifier.text === FROM_PACKAGE),
        Query.collect,
      )

      return yield* Draft.replaceEach(references, ({ value }) =>
        rewriteSpecifier(value.moduleSpecifier),
      )
    }),
})
