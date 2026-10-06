/**
 * Convert `export default function authenticate` into a named export and
 * rewrite default import sites plus `export { default as authenticate }` barrels.
 */
import { Proposal, Pattern as P, type WorkspacePath, Query, Recipe, type Workspace } from "safemods"
import { Effect } from "effect"
import { and, refineDefinedKey, refineKey } from "is-kit"
import {
  type ExportSpecifier,
  type FunctionDeclaration,
  type NamedImportBindings,
  SyntaxKind,
} from "typescript/unstable/ast"
import {
  isExportDeclaration,
  isExportSpecifier,
  isFunctionDeclaration,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
} from "typescript/unstable/ast/is"

export interface DefaultToNamedInput {
  readonly project: Workspace.ConfiguredProject.Type
  /** Project-relative file that currently default-exports the function. */
  readonly declarationFile: WorkspacePath.Type
  readonly exportName: string
}

const named = (text: string) => P.node(isIdentifier, { text })

const reexportedNames = P.node(isExportDeclaration, {
  exportClause: P.node(isNamedExports, { elements: P.capture("elements") }),
})

const defaultSpecifier = P.tagged({
  aliased: P.node(isExportSpecifier, { propertyName: named("default"), name: P.capture("local") }),
  bare: P.node(isExportSpecifier, { propertyName: undefined, name: named("default") }),
})

const isDefaultImport = and(
  isImportDeclaration,
  refineDefinedKey("importClause", and(isImportClause, refineDefinedKey("name", isIdentifier))),
)

const hasDefaultImport = refineKey("value", isDefaultImport)

const exportsDefault = (declaration: FunctionDeclaration): boolean =>
  declaration.modifiers?.some((modifier) => modifier.kind === SyntaxKind.DefaultKeyword) === true

const namedBinding = (localName: string, exportName: string): string =>
  localName === exportName ? exportName : `${exportName} as ${localName}`

const importClauseText = (binding: string, existing: NamedImportBindings | undefined): string => {
  if (existing === undefined || !isNamedImports(existing)) return `{ ${binding} }`
  const kept = existing
    .getText()
    .replace(/^\{\s*/, "")
    .replace(/\s*\}$/, "")
  return `{ ${binding}, ${kept} }`
}

const rebinding = (element: ExportSpecifier, exportName: string): string | undefined => {
  const matched = defaultSpecifier(element)
  if (matched === undefined) return undefined
  return matched._tag === "bare" ?
    exportName :
    namedBinding(matched.captures.local.getText(), exportName)
}

export const defaultToNamed = Recipe.define("default-to-named", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (snapshot, input: DefaultToNamedInput) =>
    Effect.gen(function* () {
      const project = yield* snapshot.project(input.project.id)
      const exported = yield* project.symbolNamed(input.exportName, {
        within: input.declarationFile,
      })

      const defaultFunctions = yield* Query.nodes(project, isFunctionDeclaration).pipe(
        Query.within(input.declarationFile),
        Query.filter(({ value }) => value.name?.text === input.exportName && exportsDefault(value)),
      )

      const defaultImports = yield* Query.imports(project).pipe(
        Query.filter(hasDefaultImport),
        Query.where(
          Query.resolvesTo(exported, {
            location: (declaration) => declaration.importClause.name,
          }),
        ),
      )

      const reexports = yield* Query.resolvedModuleReferences(project).pipe(
        Query.filter(
          ({ value }) =>
            value.kind === "export" && value.resolved?.fileName === input.declarationFile,
        ),
      )

      const importEdits = defaultImports.map(({ project, value }) => {
        const clause = value.importClause
        const binding = namedBinding(clause.name.text, input.exportName)
        return Proposal.replace(project, clause, importClauseText(binding, clause.namedBindings))
      })

      const reexportEdits = reexports.flatMap(({ project, value }) => {
        const clause = reexportedNames.match(value.node)
        if (clause === undefined) return []
        return clause.elements.flatMap((element) => {
          const binding = rebinding(element, input.exportName)
          return binding === undefined ? [] : [Proposal.replace(project, element, binding)]
        })
      })

      return Proposal.concat(
        Proposal.replaceEach(defaultFunctions, ({ value }) =>
          value.getText().replace(/^export\s+default\s+/, "export ")),
        ...importEdits,
        ...reexportEdits,
      )
    }),
})

export default defaultToNamed
