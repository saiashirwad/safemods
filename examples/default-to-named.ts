/**
 * Convert `export default function authenticate` into a named export and
 * rewrite default import sites plus `export { default as authenticate }` barrels.
 */
import { Effect } from "effect"
import { and, refineDefinedKey, refineKey } from "is-kit"
import { SyntaxKind } from "typescript/unstable/ast"
import {
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
} from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
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

const namedBinding = (localName: string, exportName: string): string =>
  localName === exportName ? exportName : `${exportName} as ${localName}`

const isDefaultImport = and(
  isImportDeclaration,
  refineDefinedKey("importClause", and(isImportClause, refineDefinedKey("name", isIdentifier))),
)

const hasDefaultImport = refineKey("value", isDefaultImport)

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
        Query.filter(
          ({ value }) =>
            value.name?.text === input.exportName &&
            (value.modifiers?.some((modifier) => modifier.kind === SyntaxKind.DefaultKeyword) ??
              false),
        ),
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
      const defaultSpecifiers = reexports.flatMap(({ project, value }) => {
        const clause = isExportDeclaration(value.node) ? value.node.exportClause : undefined
        return clause === undefined || !isNamedExports(clause)
          ? []
          : clause.elements
              .filter((element) => (element.propertyName ?? element.name).getText() === "default")
              .map((element) => ({ project, element }))
      })

      return Draft.concat(
        Draft.replaceEach(defaultFunctions, ({ value }) =>
          value.getText().replace(/^export\s+default\s+/, "export "),
        ),
        Draft.concat(
          ...defaultImports.map(({ project, value }) => {
            const clause = value.importClause
            const binding = namedBinding(clause.name.text, input.exportName)
            const namedBindings = clause.namedBindings
            if (namedBindings !== undefined && isNamedImports(namedBindings)) {
              const inner = namedBindings
                .getText()
                .replace(/^\{\s*/, "")
                .replace(/\s*\}$/, "")
              return Draft.replace(project, clause, `{ ${binding}, ${inner} }`)
            }
            return Draft.replace(project, clause, `{ ${binding} }`)
          }),
        ),
        ...defaultSpecifiers.map(({ project, element }) =>
          Draft.replace(
            project,
            element,
            element.propertyName === undefined
              ? input.exportName
              : namedBinding(element.name.getText(), input.exportName),
          ),
        ),
      )
    }),
})
