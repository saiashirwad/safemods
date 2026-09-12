import { Effect } from "effect"
import type { Node } from "typescript/unstable/ast"
import { isExportDeclaration, isStringLiteral } from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const FROM_PACKAGE = "@acme/legacy-client"
const TO_PACKAGE = "@acme/client"

const rewriteSpecifier = (specifier: Node) => {
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

      const importDeclarations = yield* Query.imports(project).pipe(
        Query.filter(
          ({ value }) =>
            isStringLiteral(value.moduleSpecifier) && value.moduleSpecifier.text === FROM_PACKAGE,
        ),
        Query.collect,
      )

      const reexports = yield* Query.nodes(project, isExportDeclaration).pipe(
        Query.filter(({ value }) => {
          const specifier = value.moduleSpecifier
          return (
            specifier !== undefined && isStringLiteral(specifier) && specifier.text === FROM_PACKAGE
          )
        }),
        Query.collect,
      )

      return yield* Draft.concat(
        yield* Draft.replaceEach(importDeclarations, ({ value }) =>
          rewriteSpecifier(value.moduleSpecifier),
        ),
        yield* Draft.replaceEach(reexports, ({ value }) => {
          const specifier = value.moduleSpecifier
          if (specifier === undefined) {
            return Draft.empty
          }
          return rewriteSpecifier(specifier)
        }),
      )
    }),
})
