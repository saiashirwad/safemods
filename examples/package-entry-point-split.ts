import { Effect } from "effect"
import {
  isExportDeclaration,
  isExportSpecifier,
  isImportDeclaration,
  isImportSpecifier,
  isNamedExports,
  isNamedImports,
} from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const ROOT = "@acme/sdk"
const entryPointByExport = new Map([
  ["login", "auth"],
  ["logout", "auth"],
  ["LoginOptions", "auth"],
  ["Session", "auth"],
  ["listInvoices", "billing"],
  ["voidInvoice", "billing"],
  ["Invoice", "billing"],
  ["ListInvoicesOptions", "billing"],
])

const quote = (text: string, specifier: string): string =>
  `${text.startsWith("'") ? "'" : '"'}${specifier}${text.startsWith("'") ? "'" : '"'}`

const importedName = (specifier: {
  readonly propertyName?: { readonly text: string }
  readonly name: { readonly text: string }
}): string => specifier.propertyName?.text ?? specifier.name.text

export const packageEntryPointSplit = Recipe.define("package-entry-point-split", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const references = yield* Effect.forEach(snapshot.projects, (project) =>
        Query.moduleReferences(project).pipe(
          Query.filter(({ value }) => value.specifier.text === ROOT),
          Query.collect,
        ),
      )
      return Draft.concat(
        ...references.flat().map((selection) => {
          const { node, specifier } = selection.value
          const clause = isImportDeclaration(node)
            ? node.importClause?.namedBindings
            : isExportDeclaration(node)
              ? node.exportClause
              : undefined
          const elements =
            clause !== undefined && (isNamedImports(clause) || isNamedExports(clause))
              ? clause.elements
              : undefined
          if (elements === undefined) {
            return Draft.unsupported(
              selection,
              "The root entry point is ambiguous here; choose @acme/sdk/auth or @acme/sdk/billing manually",
            )
          }
          const entryPoints = new Set(
            elements
              .filter((element) => isImportSpecifier(element) || isExportSpecifier(element))
              .map(importedName)
              .map((name) => entryPointByExport.get(name)),
          )
          if (entryPoints.size !== 1 || entryPoints.has(undefined)) {
            return Draft.unsupported(
              selection,
              "This declaration mixes exports from different package entry points",
            )
          }
          const [entryPoint] = entryPoints
          return Draft.replace(
            selection.project,
            specifier,
            quote(specifier.getText(), `${ROOT}/${entryPoint}`),
          )
        }),
      )
    }),
})
