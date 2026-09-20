/**
 * Convert `export default function authenticate` into a named export and
 * rewrite default import sites plus `export { default as authenticate }` barrels.
 */
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
import * as Draft from "safemods/Draft"
import * as P from "safemods/Pattern"
import type * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface DefaultToNamedInput {
  readonly project: ConfiguredProject.Type
  /** Project-relative file that currently default-exports the function. */
  readonly declarationFile: ProjectRelativePath.Type
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
  run: (input: DefaultToNamedInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)
      const exported = yield* project.symbolNamed(input.exportName, {
        within: input.declarationFile,
      })

      const defaultFunctions = yield* Query.nodes(project, isFunctionDeclaration).pipe(
        Query.within(input.declarationFile),
        Query.filter(({ value }) => value.name?.text === input.exportName && exportsDefault(value)),
        Query.collect,
      )

      const defaultImports = yield* Query.imports(project).pipe(
        Query.filter(hasDefaultImport),
        Query.where(
          Query.resolvesTo(exported, {
            location: (declaration) => declaration.importClause.name,
          }),
        ),
        Query.collect,
      )

      const reexports = yield* Query.resolvedModuleReferences(project).pipe(
        Query.filter(
          ({ value }) =>
            value.kind === "export" && value.resolved?.fileName === input.declarationFile,
        ),
        Query.collect,
      )

      const importEdits = defaultImports.map(({ project, value }) => {
        const clause = value.importClause
        const binding = namedBinding(clause.name.text, input.exportName)
        return Draft.replace(project, clause, importClauseText(binding, clause.namedBindings))
      })

      const reexportEdits = reexports.flatMap(({ project, value }) => {
        const clause = reexportedNames.match(value.node)
        if (clause === undefined) return []
        return clause.elements.flatMap((element) => {
          const binding = rebinding(element, input.exportName)
          return binding === undefined ? [] : [Draft.replace(project, element, binding)]
        })
      })

      return Draft.concat(
        Draft.replaceEach(defaultFunctions, ({ value }) =>
          value.getText().replace(/^export\s+default\s+/, "export ")),
        ...importEdits,
        ...reexportEdits,
      )
    }),
})
