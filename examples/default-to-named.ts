/**
 * Convert `export default function authenticate` into a named export and
 * rewrite default import sites plus `export { default as authenticate }` barrels.
 */
import { Effect } from "effect"
import { SyntaxKind } from "typescript/unstable/ast"
import {
  isExportDeclaration,
  isFunctionDeclaration,
  isNamedExports,
  isNamedImports,
  isStringLiteral,
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

const pointsAtDeclaration = (specifier: string, declarationFile: string): boolean => {
  const modulePath = declarationFile.replace(/\.ts$/, ".js")
  const baseName = modulePath.slice(modulePath.lastIndexOf("/") + 1)
  return (
    specifier === `./${baseName}` || specifier === modulePath || specifier.endsWith(`/${baseName}`)
  )
}

const namedBinding = (localName: string, exportName: string): string =>
  localName === exportName ? exportName : `${exportName} as ${localName}`

const rewriteDefaultReexport = (source: string, exportName: string): string => {
  const aliased = source.replace(`default as ${exportName}`, exportName)
  return aliased === source ? source.replace("{ default }", `{ ${exportName} }`) : aliased
}

export const defaultToNamed = Recipe.define("default-to-named", {
  version: "1.0.0",
  policies: { matchCount: { min: 1 }, idempotence: "required" },
  run: (input: DefaultToNamedInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project)
      const exported = yield* project.symbolNamed(input.exportName, {
        within: input.declarationFile,
      })

      const defaultFunctions = yield* Query.nodes(
        project,
        isFunctionDeclaration,
        SyntaxKind.FunctionDeclaration,
      ).pipe(
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
        Query.filter(({ value }) => value.importClause?.name !== undefined),
        Query.where(
          Query.resolvesTo(exported, {
            location: (declaration) => declaration.importClause!.name!,
          }),
        ),
        Query.collect,
      )

      const defaultReexports = yield* Query.nodes(
        project,
        isExportDeclaration,
        SyntaxKind.ExportDeclaration,
      ).pipe(
        Query.filter(({ value }) => {
          if (
            value.moduleSpecifier === undefined ||
            !isStringLiteral(value.moduleSpecifier) ||
            !pointsAtDeclaration(value.moduleSpecifier.text, input.declarationFile)
          ) {
            return false
          }
          const clause = value.exportClause
          return (
            clause !== undefined &&
            isNamedExports(clause) &&
            clause.elements.some(
              (element) => (element.propertyName ?? element.name).getText() === "default",
            )
          )
        }),
        Query.collect,
      )

      return yield* Draft.concat(
        yield* Draft.replaceEach(defaultFunctions, ({ value }) =>
          value.getText().replace(/^export\s+default\s+/, "export "),
        ),
        yield* Draft.replaceEach(defaultImports, ({ value }) => {
          const clause = value.importClause!
          const binding = namedBinding(clause.name!.text, input.exportName)
          const namedBindings = clause.namedBindings
          if (namedBindings !== undefined && isNamedImports(namedBindings)) {
            const inner = namedBindings
              .getText()
              .replace(/^\{\s*/, "")
              .replace(/\s*\}$/, "")
            return { node: clause, text: `{ ${binding}, ${inner} }` }
          }
          return { node: clause, text: `{ ${binding} }` }
        }),
        yield* Draft.replaceEach(defaultReexports, ({ value }) =>
          rewriteDefaultReexport(value.getText(), input.exportName),
        ),
      )
    }),
})
