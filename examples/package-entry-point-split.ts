import { Effect } from "effect"
import type { ExportSpecifier, ImportSpecifier } from "typescript/unstable/ast"
import {
  isExportDeclaration,
  isImportClause,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
} from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as P from "safemods/Pattern"
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

const AMBIGUOUS =
  `The root entry point is ambiguous here; choose ${ROOT}/auth or ${ROOT}/billing manually`
const MIXED = "This declaration mixes exports from different package entry points"

const namedBindings = P.either(
  P.node(isImportDeclaration, {
    importClause: P.node(isImportClause, {
      namedBindings: P.node(isNamedImports, { elements: P.capture("elements") }),
    }),
  }),
  P.node(isExportDeclaration, {
    exportClause: P.node(isNamedExports, { elements: P.capture("elements") }),
  }),
)

const entryPointOf = (element: ImportSpecifier | ExportSpecifier): string | undefined =>
  entryPointByExport.get(element.propertyName?.text ?? element.name.text)

const split = (selection: Query.Selection<Query.ModuleReference>): Draft.Draft => {
  const bound = namedBindings.match(selection.value.node)
  if (bound === undefined) {
    return Draft.unsupported(selection, AMBIGUOUS)
  }
  const entryPoints = new Set([...bound.elements].map(entryPointOf))
  const [entryPoint] = entryPoints
  if (entryPoints.size !== 1 || entryPoint === undefined) {
    return Draft.unsupported(selection, MIXED)
  }
  return Draft.replaceStringLiteral(
    selection.project,
    selection.value.specifier,
    `${ROOT}/${entryPoint}`,
  )
}

export const packageEntryPointSplit = Recipe.define("package-entry-point-split", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const references = yield* Effect.forEach(snapshot.projects, (project) =>
        Query.moduleReferences(project).pipe(
          Query.filter(({ value }) =>
            value.specifier.text === ROOT
          ),
          Query.collect,
        ))
      return Draft.concat(...references.flat().map(split))
    }),
})
