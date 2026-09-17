/**
 * Convert a conservative subset of top-level CommonJS to ESM.
 * Unsupported CommonJS-shaped statements are reported rather than guessed at.
 */
import { Effect } from "effect"
import { SyntaxKind, type Node, type Statement } from "typescript/unstable/ast"
import {
  isBinaryExpression,
  isCallExpression,
  isElementAccessExpression,
  isExpressionStatement,
  isIdentifier,
  isObjectBindingPattern,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableStatement,
} from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface CommonJsToEsmInput {
  readonly project: ConfiguredProject.Type
}

const identifier = /^[A-Za-z_$][\w$]*$/

const requireCall = (node: Node) =>
  isCallExpression(node) &&
  isIdentifier(node.expression) &&
  node.expression.text === "require" &&
  node.arguments.length === 1 &&
  node.arguments[0] !== undefined &&
  isStringLiteral(node.arguments[0])
    ? node.arguments[0]
    : undefined

const requireIsGlobal = (node: Node): boolean => {
  let scope: Node = node
  for (;;) {
    const locals = (scope as Node & { readonly locals?: Map<string, unknown> }).locals
    if (locals?.has("require")) return false
    if (scope.parent === undefined) return true
    scope = scope.parent
  }
}

const propertyName = (node: Node): string | undefined => {
  if (isPropertyAccessExpression(node)) return node.name.text
  if (isElementAccessExpression(node) && isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text
  }
  return undefined
}

const importFor = (statement: Statement): string | undefined => {
  if (isExpressionStatement(statement)) {
    const specifier = requireCall(statement.expression)
    return specifier !== undefined && requireIsGlobal(statement.expression)
      ? `import ${specifier.getText()}`
      : undefined
  }
  if (!isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    return undefined
  }
  const declaration = statement.declarationList.declarations[0]!
  if (declaration.initializer === undefined) return undefined
  const direct = requireCall(declaration.initializer)
  if (direct !== undefined && requireIsGlobal(declaration.initializer)) {
    if (isIdentifier(declaration.name)) {
      return `import * as ${declaration.name.text} from ${direct.getText()}`
    }
    if (isObjectBindingPattern(declaration.name)) {
      const bindings: Array<string> = []
      for (const element of declaration.name.elements) {
        const name = element.name
        if (
          element.dotDotDotToken !== undefined ||
          element.initializer !== undefined ||
          name === undefined ||
          !isIdentifier(name)
        ) {
          return undefined
        }
        const imported = element.propertyName?.getText() ?? name.getText()
        bindings.push(imported === name.text ? imported : `${imported} as ${name.text}`)
      }
      return `import { ${bindings.join(", ")} } from ${direct.getText()}`
    }
  }
  if (isIdentifier(declaration.name)) {
    const member = propertyName(declaration.initializer)
    const receiver =
      isPropertyAccessExpression(declaration.initializer) ||
      isElementAccessExpression(declaration.initializer)
        ? declaration.initializer.expression
        : undefined
    const specifier = receiver === undefined ? undefined : requireCall(receiver)
    if (
      receiver !== undefined &&
      member !== undefined &&
      specifier !== undefined &&
      requireIsGlobal(receiver)
    ) {
      return `import { ${member === declaration.name.text ? member : `${member} as ${declaration.name.text}`} } from ${specifier.getText()}`
    }
  }
  return undefined
}

const exportFor = (statement: Statement): string | undefined => {
  if (!isExpressionStatement(statement) || !isBinaryExpression(statement.expression))
    return undefined
  const assignment = statement.expression
  if (assignment.operatorToken.kind !== SyntaxKind.EqualsToken) return undefined
  const left = assignment.left
  if (
    isPropertyAccessExpression(left) &&
    isIdentifier(left.expression) &&
    left.expression.text === "module" &&
    left.name.text === "exports"
  ) {
    return `export default ${assignment.right.getText()}`
  }
  if (isPropertyAccessExpression(left)) {
    const receiver = left.expression
    const directExports = isIdentifier(receiver) && receiver.text === "exports"
    const moduleExports =
      isPropertyAccessExpression(receiver) &&
      isIdentifier(receiver.expression) &&
      receiver.expression.text === "module" &&
      receiver.name.text === "exports"
    if ((directExports || moduleExports) && identifier.test(left.name.text)) {
      return `export const ${left.name.text} = ${assignment.right.getText()}`
    }
  }
  return undefined
}

const commonJsShaped = (statement: Statement): boolean =>
  /\b(?:require\s*\(|module\s*\.\s*exports|exports\s*(?:\.|\[))/.test(statement.getText())

export const commonJsToEsm = Recipe.define("commonjs-to-esm", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: CommonJsToEsmInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)
      const moduleReferences = yield* Query.moduleReferences(project).pipe(Query.collect)
      const globalRequires = new Set(
        moduleReferences
          .filter(({ value }) => value.kind === "require" && requireIsGlobal(value.node))
          .map(({ value }) => value.node),
      )
      const files = yield* project.files
      const drafts: Array<Draft.Draft> = []
      for (const file of files) {
        for (const statement of file.sourceFile.statements) {
          const replacement = importFor(statement) ?? exportFor(statement)
          if (replacement !== undefined) {
            drafts.push(Draft.replace(project, statement, replacement))
          } else if (
            (commonJsShaped(statement) &&
              [...globalRequires].some(
                (node) =>
                  node.getSourceFile() === file.sourceFile &&
                  node.getStart() >= statement.getStart() &&
                  node.getEnd() <= statement.getEnd(),
              )) ||
            /\b(?:module\s*\.\s*exports|exports\s*(?:\.|\[))/.test(statement.getText())
          ) {
            drafts.push(
              Draft.unsupported(
                {
                  value: statement,
                  project,
                  fileName: file.fileName,
                  start: statement.getStart(file.sourceFile),
                  end: statement.getEnd(),
                },
                "CommonJS form is not a supported top-level conversion",
              ),
            )
          }
        }
      }
      return Draft.concat(...drafts)
    }),
})
