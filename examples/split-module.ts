/**
 * Split `src/accounts.ts` into a type-only model, a service, and a public index, then point each
 * consumer at the half it uses. Everything is derived from the source: declarations are
 * partitioned by kind, the checker decides which types the service needs, and consumers are
 * found by where their specifiers resolve. Shapes the recipe cannot split are reported.
 */
import { Effect } from "effect"
import {
  type ClassDeclaration,
  type ExportSpecifier,
  type FunctionDeclaration,
  type Identifier,
  type ImportSpecifier,
  type InterfaceDeclaration,
  type Node,
  type Statement,
  SyntaxKind,
  type TypeAliasDeclaration,
  type VariableStatement,
} from "typescript/unstable/ast"
import {
  isClassDeclaration,
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isInterfaceDeclaration,
  isNamedExports,
  isNamedImports,
  isTypeAliasDeclaration,
  isVariableStatement,
} from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as ModuleSpecifier from "safemods/ModuleSpecifier"
import * as P from "safemods/Pattern"
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

type Declaration =
  | ClassDeclaration
  | FunctionDeclaration
  | InterfaceDeclaration
  | TypeAliasDeclaration
  | VariableStatement

interface Declared {
  readonly statement: Declaration
  readonly names: ReadonlyArray<Identifier>
}

const declaredIn = (statement: Statement): Declared | undefined => {
  if (isVariableStatement(statement)) {
    const names = statement.declarationList.declarations.map((declaration) => declaration.name)
    return names.every(isIdentifier) ? { statement, names } : undefined
  }
  if (
    isInterfaceDeclaration(statement) ||
    isTypeAliasDeclaration(statement) ||
    isFunctionDeclaration(statement) ||
    isClassDeclaration(statement)
  ) {
    return statement.name === undefined ? undefined : { statement, names: [statement.name] }
  }
  return undefined
}

const isType = ({ statement }: Declared): boolean =>
  isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement)

const isExported = ({ statement }: Declared): boolean =>
  statement.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ?? false

const namesOf = (group: ReadonlyArray<Declared>): ReadonlyArray<string> =>
  group.flatMap(({ names }) => names.map((name) => name.text))

const textOf = (group: ReadonlyArray<Declared>): string =>
  group
    .map(({ statement }) =>
      statement.getSourceFile().text.slice(statement.getFullStart(), statement.getEnd()).trim(),
    )
    .join("\n\n")

const splittableConsumer = P.tagged({
  import: P.node(isImportDeclaration, {
    importClause: P.node(isImportClause, {
      name: undefined,
      namedBindings: P.node(isNamedImports, { elements: P.capture("elements") }),
    }),
  }),
  export: P.node(isExportDeclaration, {
    exportClause: P.node(isNamedExports, { elements: P.capture("elements") }),
  }),
})

const bindingText = (element: ImportSpecifier | ExportSpecifier): string =>
  element.propertyName === undefined
    ? element.name.getText()
    : `${element.propertyName.getText()} as ${element.name.getText()}`

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
      const unsplittable = statements.filter((statement) => declaredIn(statement) === undefined)
      if (unsplittable.length > 0) {
        return Draft.concat(
          ...unsplittable.map((statement) =>
            Draft.unsupported(selectionOf(statement), "only named declarations can be split"),
          ),
        )
      }

      const declarations = statements.flatMap((statement) => declaredIn(statement) ?? [])
      const types = declarations.filter(isType)
      const values = declarations.filter((declared) => !isType(declared))

      const inService = (reference: Node): boolean =>
        reference.getSourceFile() === source.sourceFile &&
        values.some(
          ({ statement }) =>
            reference.pos >= statement.getFullStart() && reference.pos < statement.getEnd(),
        )
      const usedByService = ({ names }: Declared) =>
        Effect.map(
          Effect.forEach(names, (name) => project.referencesTo(name), { concurrency: "unbounded" }),
          (references) => references.flat().some(inService),
        )
      const used = yield* Effect.forEach(types, usedByService, { concurrency: "unbounded" })
      const serviceNeeds = types.filter((_, index) => used[index])

      const hidden = serviceNeeds.filter((declared) => !isExported(declared))
      if (hidden.length > 0) {
        return Draft.concat(
          ...hidden.map(({ statement }) =>
            Draft.unsupported(selectionOf(statement), "the service needs this unexported type"),
          ),
        )
      }

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

      const splitConsumer = (
        selection: Query.Selection<Query.ResolvedModuleReference>,
      ): Draft.Draft => {
        const { specifier, typeOnly } = selection.value
        const matched = splittableConsumer(selection.value.node)
        if (matched === undefined) {
          return Draft.unsupported(selection, "only named imports and re-exports can be split")
        }
        const quote = specifier.getText().startsWith("'") ? "'" : '"'
        const semicolon = matched.node.getText().endsWith(";") ? ";" : ""
        const from = (target: string): string =>
          `${quote}${ModuleSpecifier.emitted(ModuleSpecifier.between(selection.fileName, target))}${quote}`
        const line = (bindings: ReadonlyArray<string>, modifier: string, target: string): string =>
          `${matched._tag}${modifier} { ${bindings.join(", ")} } from ${from(target)}${semicolon}`
        const isTypeBinding = (element: ImportSpecifier | ExportSpecifier): boolean =>
          typeNames.has((element.propertyName ?? element.name).getText())
        const elements = [...matched.captures.elements]
        const fromModel = elements.filter(isTypeBinding).map(bindingText)
        const fromService = elements
          .filter((element) => !isTypeBinding(element))
          .map(
            (element) => `${element.isTypeOnly && !typeOnly ? "type " : ""}${bindingText(element)}`,
          )
        const lines = [
          fromModel.length === 0 ? undefined : line(fromModel, " type", paths.model),
          fromService.length === 0
            ? undefined
            : line(fromService, typeOnly ? " type" : "", paths.service),
        ].filter((text) => text !== undefined)
        return Draft.replace(project, matched.node, lines.join("\n"))
      }

      const consumers = yield* Query.resolvedModuleReferences(project).pipe(
        Query.filter(({ value }) => value.resolved?.fileName === paths.source),
        Query.collect,
      )

      return Draft.concat(
        Draft.deleteFile(source),
        Draft.createFile(project, paths.model, `${textOf(types)}\n`),
        Draft.createFile(project, paths.service, `${service}\n`),
        Draft.createFile(project, paths.index, `${index}\n`),
        ...consumers.map(splitConsumer),
      )
    }),
})
