import { type Identifier, type Node, SyntaxKind } from "typescript/unstable/ast"
import {
  isArrayLiteralExpression,
  isAsExpression,
  isBinaryExpression,
  isExportSpecifier,
  isExpressionWithTypeArguments,
  isForInStatement,
  isForOfStatement,
  isHeritageClause,
  isImportClause,
  isImportEqualsDeclaration,
  isImportSpecifier,
  isInterfaceDeclaration,
  isNamespaceImport,
  isNonNullExpression,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
  isTypeAssertion,
  isTypeNode,
} from "typescript/unstable/ast/is"
import type { ProjectSnapshotError } from "../Workspace/index.ts"
import { identifiers, type Scope } from "./nodes.ts"
import { mapValues, type Query } from "./selection.ts"

export type ReferenceRole =
  | "declaration"
  | "read"
  | "write"
  | "type"
  | "import"
  | "export"
  | "property-name"
  | "shorthand"

export interface SemanticReference {
  readonly node: Identifier
  readonly role: ReferenceRole
}

const hasTypeAncestor = (node: Node): boolean => {
  let child = node
  for (;;) {
    const parent = child.parent
    if (isExpressionWithTypeArguments(parent) && parent.expression === child) {
      const heritage = parent.parent
      if (
        isHeritageClause(heritage) &&
        (heritage.token === SyntaxKind.ImplementsKeyword || isInterfaceDeclaration(heritage.parent))
      ) return true
    } else if (isTypeNode(parent)) return true
    if (parent.getSourceFile() === parent) return false
    child = parent
  }
}

const isWriteTarget = (node: Node): boolean => {
  let target = node
  for (;;) {
    const parent = target.parent
    if (isBinaryExpression(parent) && parent.left === target) {
      const operator = parent.operatorToken.kind
      return operator >= SyntaxKind.FirstAssignment && operator <= SyntaxKind.LastAssignment
    }
    if (isForOfStatement(parent) || isForInStatement(parent)) {
      return parent.initializer === target
    }
    if (isPrefixUnaryExpression(parent) || isPostfixUnaryExpression(parent)) {
      return parent.operator === SyntaxKind.PlusPlusToken ||
        parent.operator === SyntaxKind.MinusMinusToken
    }
    if (
      isArrayLiteralExpression(parent) ||
      isObjectLiteralExpression(parent) ||
      (isPropertyAssignment(parent) && parent.initializer === target) ||
      (isShorthandPropertyAssignment(parent) && parent.name === target) ||
      ((isSpreadElement(parent) || isSpreadAssignment(parent) ||
        isParenthesizedExpression(parent) || isAsExpression(parent) ||
        isTypeAssertion(parent) || isNonNullExpression(parent) ||
        isSatisfiesExpression(parent)) && parent.expression === target)
    ) {
      target = parent
    } else return false
  }
}

const roleOf = (node: Identifier): ReferenceRole => {
  const parent = node.parent
  if (
    isImportSpecifier(parent) ||
    isImportClause(parent) ||
    isNamespaceImport(parent) ||
    isImportEqualsDeclaration(parent)
  ) {
    return "import"
  }
  if (isExportSpecifier(parent)) return "export"
  if (
    (isPropertyAccessExpression(parent) && parent.name === node) ||
    (isPropertyAssignment(parent) && parent.name === node)
  ) {
    return "property-name"
  }
  if (hasTypeAncestor(node)) return "type"
  if (isWriteTarget(node)) return "write"
  if (isShorthandPropertyAssignment(parent) && parent.name === node) return "shorthand"
  const symbolParent = parent as Node & { readonly name?: Node }
  if (symbolParent.name === node && !isPropertyAssignment(parent)) return "declaration"
  return "read"
}

export const semanticReferences = (scope: Scope): Query<SemanticReference, ProjectSnapshotError> =>
  mapValues(identifiers(scope), ({ value }) => ({ node: value, role: roleOf(value) }))
