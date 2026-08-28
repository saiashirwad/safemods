import { Effect } from "effect"
import type { ImportDeclaration, SourceFile, Statement } from "typescript/unstable/ast"
import {
  isExpressionStatement,
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import {
  isProjectFile,
  type ProjectFile,
  type ProjectSnapshot,
  type ProjectSnapshotError,
  type SnapshotExpired,
} from "../Workspace/index.ts"
import { draftForRange, empty, type Draft } from "./Draft.ts"

export interface AddNamedImportOptions {
  readonly module: string
  readonly name: string
  readonly alias?: string
}

export interface AddNamedImportFn {
  (file: ProjectFile, options: AddNamedImportOptions): Effect.Effect<Draft, ProjectSnapshotError>
  (
    project: ProjectSnapshot,
    fileName: string,
    options: AddNamedImportOptions,
  ): Effect.Effect<Draft, ProjectSnapshotError>
}

const isTopLevelDirective = (statement: Statement): boolean =>
  isExpressionStatement(statement) && isStringLiteral(statement.expression)

const importInsertionPosition = (sourceFile: SourceFile): number => {
  // getStart skips a shebang and leading trivia, preserving license headers
  // and comments while anchoring insertion to an actual statement token.
  const firstNonDirective = sourceFile.statements.find(
    (statement) => !isTopLevelDirective(statement),
  )
  return firstNonDirective?.getStart(sourceFile) ?? sourceFile.endOfFileToken.getStart(sourceFile)
}

/** Add a named import to the source file at `fileName`. */
const addNamedToProject = (
  project: ProjectSnapshot,
  fileName: string,
  options: AddNamedImportOptions,
): Effect.Effect<Draft, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const source = yield* project.sourceFile(fileName)
    if (source === undefined) {
      return empty
    }

    return yield* project.unsafeNative(() =>
      Effect.sync((): Draft => {
        const importName = options.alias ? `${options.name} as ${options.alias}` : options.name

        for (const statement of source.statements) {
          if (isImportDeclaration(statement)) {
            const specifier = statement.moduleSpecifier
            if (isStringLiteral(specifier) && specifier.text === options.module) {
              const clause = statement.importClause
              if (clause && clause.namedBindings && isNamedImports(clause.namedBindings)) {
                const named = clause.namedBindings
                if (
                  clause.phaseModifier !== undefined ||
                  named.elements.some((element) => element.isTypeOnly)
                ) {
                  return empty
                }
                for (const element of named.elements) {
                  if (element.name.text === (options.alias ?? options.name)) {
                    return empty
                  }
                }

                if (named.elements.length > 0) {
                  const last = named.elements[named.elements.length - 1]!
                  const insertPos = last.getEnd()
                  return draftForRange(
                    project,
                    source,
                    insertPos,
                    insertPos,
                    `, ${importName}`,
                    `import:addNamed:${options.module}:${options.name}`,
                    { module: options.module, name: options.name },
                  )
                }
              }
            }
          }
        }

        const insertPos = importInsertionPosition(source)
        const importText = `import { ${importName} } from "${options.module}";\n`

        return draftForRange(
          project,
          source,
          insertPos,
          insertPos,
          importText,
          `import:addNamed:${options.module}:${options.name}`,
          { module: options.module, name: options.name },
        )
      }),
    )
  })

export const imports = {
  /** Add a named import to a source file. */
  // SAFETY: the dispatcher is exhaustive over ProjectFile | ProjectSnapshot
  // and hands each overload its exact declared parameter shapes.
  addNamed: ((
    projectOrFile: ProjectSnapshot | ProjectFile,
    fileNameOrOptions: string | AddNamedImportOptions,
    maybeOptions?: AddNamedImportOptions,
  ): Effect.Effect<Draft, ProjectSnapshotError> => {
    if (isProjectFile(projectOrFile)) {
      // SAFETY: the ProjectFile overload passes the options object in the
      // second argument position.
      const options = fileNameOrOptions as AddNamedImportOptions
      return addNamedToProject(projectOrFile.project, projectOrFile.path, options)
    }
    // SAFETY: without a ProjectFile the signature is (project, fileName,
    // options), so fileNameOrOptions is the path and maybeOptions is present.
    const fileName = fileNameOrOptions as string
    const options = maybeOptions!
    return addNamedToProject(projectOrFile, fileName, options)
  }) as AddNamedImportFn,

  /** Remove a named import from an import declaration. */
  removeNamed: (
    project: ProjectSnapshot,
    declaration: ImportDeclaration,
    name: string,
  ): Effect.Effect<Draft, SnapshotExpired> =>
    project.unsafeNative(() =>
      Effect.sync((): Draft => {
        const clause = declaration.importClause
        if (!clause || !clause.namedBindings || !isNamedImports(clause.namedBindings)) {
          return empty
        }

        const named = clause.namedBindings
        const elements = named.elements
        const targetIndex = elements.findIndex(
          (el) => el.name.text === name || el.propertyName?.text === name,
        )

        if (targetIndex === -1) return empty

        const sourceFile = declaration.getSourceFile()

        if (elements.length === 1) {
          const start = clause.name?.getEnd() ?? declaration.getFullStart()
          const end = clause.name === undefined ? declaration.getEnd() : named.getEnd()
          return draftForRange(project, sourceFile, start, end, "", `import:removeNamed:${name}`, {
            name,
          })
        }

        const target = elements[targetIndex]!
        let start = target.getStart(sourceFile)
        let end = target.getEnd()

        if (targetIndex < elements.length - 1) {
          const next = elements[targetIndex + 1]!
          end = next.getStart(sourceFile)
        } else if (targetIndex > 0) {
          const prev = elements[targetIndex - 1]!
          start = prev.getEnd()
        }

        return draftForRange(project, sourceFile, start, end, "", `import:removeNamed:${name}`, {
          name,
        })
      }),
    ),

  /** Update an import module specifier source path. */
  updateSource: (
    project: ProjectSnapshot,
    declaration: ImportDeclaration,
    newModule: string,
  ): Effect.Effect<Draft, SnapshotExpired> =>
    project.unsafeNative(() =>
      Effect.sync((): Draft => {
        const specifier = declaration.moduleSpecifier
        if (!isStringLiteral(specifier)) return empty
        if (specifier.text === newModule) return empty

        const sourceFile = declaration.getSourceFile()
        const quote = specifier.getText(sourceFile)[0] ?? '"'
        const newSpecifierText = `${quote}${newModule}${quote}`
        const start = specifier.getStart(sourceFile)
        const end = specifier.getEnd()

        return draftForRange(
          project,
          sourceFile,
          start,
          end,
          newSpecifierText,
          `import:update-source:${newModule}`,
          { module: newModule },
        )
      }),
    ),
}
