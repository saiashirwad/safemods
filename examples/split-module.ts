/**
 * Split `src/accounts.ts` into a type-only model, a service, and a public index, then point each
 * consumer at the half it uses. Everything is derived from the source: declarations are
 * partitioned by kind, the checker decides which types the service needs, and consumers are
 * found by where their specifiers resolve. Shapes the recipe cannot split are reported.
 */
import { dirname, relative } from "node:path/posix"
import { Effect } from "effect"
import { type Identifier, type Statement, SyntaxKind } from "typescript/unstable/ast"
import {
  isClassDeclaration,
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isNamedExports,
  isNamedImports,
  isTypeAliasDeclaration,
  isVariableStatement,
} from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface SplitModuleInput {
  readonly project: ConfiguredProject.Type
}

const paths = {
  source: ProjectRelativePath.schema.make("src/accounts.ts"),
  model: ProjectRelativePath.schema.make("src/accounts/model.ts"),
  service: ProjectRelativePath.schema.make("src/accounts/service.ts"),
  index: ProjectRelativePath.schema.make("src/accounts/index.ts"),
}

const isTypeDeclaration = (statement: Statement): boolean =>
  isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement)

const isExported = (statement: Statement): boolean =>
  (
    statement as Statement & { readonly modifiers?: ReadonlyArray<{ readonly kind: SyntaxKind }> }
  ).modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ?? false

const declaredNames = (statement: Statement): ReadonlyArray<Identifier> | undefined => {
  if (isVariableStatement(statement)) {
    const names = statement.declarationList.declarations.map((declaration) => declaration.name)
    return names.every(isIdentifier) ? names : undefined
  }
  if (
    isInterfaceDeclaration(statement) ||
    isTypeAliasDeclaration(statement) ||
    isFunctionDeclaration(statement) ||
    isClassDeclaration(statement)
  ) {
    return statement.name === undefined ? undefined : [statement.name]
  }
  return undefined
}

const textOf = (statements: ReadonlyArray<Statement>): string =>
  statements
    .map((statement) =>
      statement.getSourceFile().text.slice(statement.getFullStart(), statement.getEnd()).trim(),
    )
    .join("\n\n")

const specifierTo = (fromFile: string, target: string): string => {
  const path = relative(dirname(fromFile), target).replace(/\.ts$/, ".js")
  return path.startsWith(".") ? path : `./${path}`
}

export const splitModule = Recipe.define("split-module", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: SplitModuleInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)
      const source = yield* project.file(paths.source)
      if (source === undefined) return Draft.empty
      for (const target of [paths.model, paths.service, paths.index]) {
        if ((yield* project.file(target)) !== undefined) return Draft.empty
      }

      const selectionOf = (statement: Statement): Query.Selection<Statement> => ({
        value: statement,
        project,
        fileName: paths.source,
        start: statement.getStart(source.sourceFile),
        end: statement.getEnd(),
      })
      const statements = [...source.sourceFile.statements]
      const unsplittable = statements.filter((statement) => declaredNames(statement) === undefined)
      if (unsplittable.length > 0) {
        return Draft.concat(
          ...unsplittable.map((statement) =>
            Draft.unsupported(selectionOf(statement), "only named declarations can be split"),
          ),
        )
      }

      const types = statements.filter(isTypeDeclaration)
      const values = statements.filter((statement) => !isTypeDeclaration(statement))
      const insideService = (position: number): boolean =>
        values.some((value) => position >= value.getFullStart() && position < value.getEnd())

      const usedByService = yield* Effect.forEach(
        types,
        (statement) =>
          Effect.map(project.referencesTo(declaredNames(statement)![0]!), (references) =>
            references.some(
              (reference) =>
                reference.getSourceFile() === source.sourceFile && insideService(reference.pos),
            ),
          ),
        { concurrency: "unbounded" },
      )
      const serviceNeeds = types.filter((_, index) => usedByService[index])
      const hidden = serviceNeeds.filter((statement) => !isExported(statement))
      if (hidden.length > 0) {
        return Draft.concat(
          ...hidden.map((statement) =>
            Draft.unsupported(selectionOf(statement), "the service needs this unexported type"),
          ),
        )
      }

      const namesOf = (group: ReadonlyArray<Statement>): ReadonlyArray<string> =>
        group.flatMap((statement) => declaredNames(statement)!.map((name) => name.text))
      const typeNames = new Set(namesOf(types))
      const neededTypes = namesOf(serviceNeeds)
      const service =
        neededTypes.length === 0
          ? textOf(values)
          : `import type { ${neededTypes.join(", ")} } from "./model.js"\n\n${textOf(values)}`
      const index = [
        `export type { ${namesOf(types.filter(isExported)).join(", ")} } from "./model.js"`,
        `export { ${namesOf(values.filter(isExported)).join(", ")} } from "./service.js"`,
      ].join("\n")

      const consumers = yield* Query.resolvedModuleReferences(project).pipe(
        Query.filter(({ value }) => value.resolved?.fileName === paths.source),
        Query.collect,
      )

      return Draft.concat(
        Draft.deleteFile(source),
        Draft.createFile(project, paths.model, `${textOf(types)}\n`),
        Draft.createFile(project, paths.service, `${service}\n`),
        Draft.createFile(project, paths.index, `${index}\n`),
        ...consumers.map((selection) => {
          const { node, specifier } = selection.value
          const bindings = isImportDeclaration(node)
            ? node.importClause?.name === undefined
              ? node.importClause?.namedBindings
              : undefined
            : isExportDeclaration(node)
              ? node.exportClause
              : undefined
          if (bindings === undefined || !(isNamedImports(bindings) || isNamedExports(bindings))) {
            return Draft.unsupported(selection, "only named imports and re-exports can be split")
          }
          const keyword = isImportDeclaration(node) ? "import" : "export"
          const typeOnly = isImportDeclaration(node)
            ? node.importClause?.phaseModifier !== undefined
            : isExportDeclaration(node) && node.isTypeOnly
          const quote = specifier.getText().startsWith("'") ? "'" : '"'
          const end = node.getText().endsWith(";") ? ";" : ""
          const line = (names: ReadonlyArray<string>, modifier: string, target: string): string =>
            `${keyword}${modifier} { ${names.join(", ")} } from ${quote}${specifierTo(selection.fileName, target)}${quote}${end}`
          const written = bindings.elements.map((element) => ({
            isType: typeNames.has((element.propertyName ?? element.name).getText()),
            text:
              element.propertyName === undefined
                ? element.name.getText()
                : `${element.propertyName.getText()} as ${element.name.getText()}`,
          }))
          const fromModel = written.filter(({ isType }) => isType).map(({ text }) => text)
          const fromService = written.filter(({ isType }) => !isType).map(({ text }) => text)
          return Draft.replace(
            project,
            node,
            [
              ...(fromModel.length === 0 ? [] : [line(fromModel, " type", paths.model)]),
              ...(fromService.length === 0
                ? []
                : [line(fromService, typeOnly ? " type" : "", paths.service)]),
            ].join("\n"),
          )
        }),
      )
    }),
})
