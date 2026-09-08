import { Effect } from "effect"
import type { ImportDeclaration, SourceFile, Statement } from "typescript/unstable/ast"
import {
  isExpressionStatement,
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import type { ProjectSnapshot, ProjectSnapshotError, SnapshotExpired } from "../Workspace/index.ts"
import { draftForRange, empty, type Draft } from "./Draft.ts"

interface AddNamedImportOptions {
  readonly module: string
  readonly name: string
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
        const importName = options.name

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
                  if (element.name.text === options.name) {
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
  addNamed: addNamedToProject,

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
}
