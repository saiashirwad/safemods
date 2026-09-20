/**
 * Convert a conservative subset of top-level CommonJS to ESM.
 * Unsupported CommonJS-shaped statements are reported rather than guessed at.
 */
import { Effect } from "effect"
import {
  type BindingElement,
  type CallExpression,
  type Node,
  type NodeArray,
  type Statement,
  SyntaxKind,
} from "typescript/unstable/ast"
import {
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isElementAccessExpression,
  isExpressionStatement,
  isIdentifier,
  isFunctionDeclaration,
  isModuleDeclaration,
  isObjectBindingPattern,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
} from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as P from "safemods/Pattern"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface CommonJsToEsmInput {
  readonly project: ConfiguredProject.Type
}

const identifier = /^[A-Za-z_$][\w$]*$/

const named = (text: string | ((text: string) => boolean)) => P.node(isIdentifier, { text })

const anyName = P.node(isIdentifier)

const requireCall = P.bind(
  "call",
  P.node(isCallExpression, {
    expression: named("require"),
    arguments: [P.bind("specifier", P.node(isStringLiteral))],
  }),
)

const declares = <Name extends P.Pattern<Node, unknown>, Init extends P.Pattern<Node, unknown>>(
  name: Name,
  initializer: Init,
) =>
  P.node(isVariableStatement, {
    declarationList: P.node(isVariableDeclarationList, {
      declarations: [P.node(isVariableDeclaration, { name, initializer })],
    }),
  })

const moduleExports = P.node(isPropertyAccessExpression, {
  expression: named("module"),
  name: named("exports"),
})

const assigns = <Left extends P.Pattern<Node, unknown>>(left: Left) =>
  P.node(isExpressionStatement, {
    expression: P.node(isBinaryExpression, {
      left,
      operatorToken: P.node((node): node is Node => node.kind === SyntaxKind.EqualsToken),
      right: P.capture("value"),
    }),
  })

const statementOf = P.tagged({
  sideEffect: P.node(isExpressionStatement, { expression: requireCall }),
  namespace: declares(P.bind("name", anyName), requireCall),
  destructured: declares(
    P.node(isObjectBindingPattern, { elements: P.capture("elements") }),
    requireCall,
  ),
  member: declares(
    P.bind("name", anyName),
    P.either(
      P.node(isPropertyAccessExpression, {
        expression: requireCall,
        name: P.bind("member", anyName),
      }),
      P.node(isElementAccessExpression, {
        expression: requireCall,
        argumentExpression: P.bind("member", P.node(isStringLiteral)),
      }),
    ),
  ),
  defaultExport: assigns(moduleExports),
  namedExport: assigns(
    P.node(isPropertyAccessExpression, {
      expression: P.either(named("exports"), moduleExports),
      name: P.bind(
        "name",
        named((text) => identifier.test(text)),
      ),
    }),
  ),
})

const declared = (modifiers: ReadonlyArray<Node> | undefined): boolean =>
  modifiers?.some((modifier) => modifier.kind === SyntaxKind.DeclareKeyword) === true

const isGlobalBlock = (scope: Node): boolean =>
  scope.kind === SyntaxKind.ModuleBlock &&
  isModuleDeclaration(scope.parent) &&
  scope.parent.keyword !== SyntaxKind.NamespaceKeyword &&
  declared(scope.parent.modifiers) &&
  isIdentifier(scope.parent.name) &&
  scope.parent.name.text === "global"

const isAmbientGlobal = (declaration: Node): boolean => {
  const statement =
    declaration.kind === SyntaxKind.VariableDeclaration ? declaration.parent.parent : declaration
  if (!isVariableStatement(statement) && !isFunctionDeclaration(statement)) return false
  const source = statement.getSourceFile()
  if (statement.parent !== source) return isGlobalBlock(statement.parent)
  return (
    (source.isDeclarationFile || declared(statement.modifiers)) &&
    source.externalModuleIndicator === undefined
  )
}

const isGlobalRequire = ({ project, value }: Query.Selection<{ readonly node: CallExpression }>) =>
  Effect.gen(function* () {
    const symbol = yield* project.symbolOf(value.node.expression)
    return symbol === undefined || (yield* project.declarationsOf(symbol)).every(isAmbientGlobal)
  })

const renamed = (imported: string, local: string): string =>
  imported === local ? imported : `${imported} as ${local}`

const plainBinding = P.node(isBindingElement, {
  dotDotDotToken: undefined,
  initializer: undefined,
  name: P.bind("local", anyName),
})

const bindingsOf = (elements: NodeArray<BindingElement>): string | undefined => {
  const bindings: Array<string> = []
  for (const element of elements) {
    const matched = plainBinding.match(element)
    if (matched === undefined) return undefined
    bindings.push(
      renamed(element.propertyName?.getText() ?? matched.local.text, matched.local.text),
    )
  }
  return bindings.join(", ")
}

const replacementFor = (
  statement: Statement,
  globalRequires: ReadonlySet<Node>,
): string | undefined => {
  const matched = statementOf(statement)
  if (matched === undefined) return undefined
  if (matched._tag === "defaultExport") return `export default ${matched.captures.value.getText()}`
  if (matched._tag === "namedExport") {
    const { name, value } = matched.captures
    return `export const ${name.text} = ${value.getText()}`
  }
  if (!globalRequires.has(matched.captures.call)) return undefined
  const from = matched.captures.specifier.getText()
  switch (matched._tag) {
    case "sideEffect":
      return `import ${from}`
    case "namespace":
      return `import * as ${matched.captures.name.text} from ${from}`
    case "member":
      return `import { ${renamed(matched.captures.member.text, matched.captures.name.text)} } from ${from}`
    case "destructured": {
      const bindings = bindingsOf(matched.captures.elements)
      return bindings === undefined ? undefined : `import { ${bindings} } from ${from}`
    }
  }
}

const exportsAssignment = /\b(?:module\s*\.\s*exports|exports\s*(?:\.|\[))/
const requireShaped = /\brequire\s*\(/

const contains = (statement: Statement, node: Node): boolean =>
  node.getSourceFile() === statement.getSourceFile() &&
  node.getStart() >= statement.getStart() &&
  node.getEnd() <= statement.getEnd()

const isUnsupported = (statement: Statement, globalRequires: ReadonlySet<Node>): boolean => {
  const text = statement.getText()
  if (exportsAssignment.test(text)) return true
  return requireShaped.test(text) && [...globalRequires].some((node) => contains(statement, node))
}

export const commonJsToEsm = Recipe.define("commonjs-to-esm", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: CommonJsToEsmInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)
      const globalRequires = new Set<Node>(
        (yield* Query.match(project, { require: requireCall }).pipe(
          Query.where(isGlobalRequire),
          Query.collect,
        )).map(({ value }) => value.node),
      )
      const files = yield* project.files
      const drafts: Array<Draft.Draft> = []
      for (const file of files) {
        for (const statement of file.sourceFile.statements) {
          const replacement = replacementFor(statement, globalRequires)
          if (replacement !== undefined) {
            drafts.push(Draft.replace(project, statement, replacement))
            continue
          }
          if (!isUnsupported(statement, globalRequires)) continue
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
      return Draft.concat(...drafts)
    }),
})
