import { Effect } from "effect"
import type { Node, StringLiteral } from "typescript/unstable/ast"
import {
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportExpression,
  isImportTypeNode,
  isLiteralTypeNode,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import type { ProjectFile, ProjectSnapshotError } from "../Workspace/index.ts"
import { nodes, type Scope } from "./nodes.ts"
import { keepDefined, mapValues, type Query } from "./selection.ts"

export type ModuleReferenceKind =
  | "import"
  | "export"
  | "dynamic-import"
  | "import-type"
  | "require"
  | "import-equals"

export interface ModuleReference {
  readonly node: Node
  readonly specifier: StringLiteral
  readonly kind: ModuleReferenceKind
  readonly typeOnly: boolean
}

const moduleReferenceOf = (node: Node): ModuleReference | undefined => {
  if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
    return {
      node,
      specifier: node.moduleSpecifier,
      kind: "import",
      typeOnly: node.importClause?.phaseModifier !== undefined,
    }
  }
  if (
    isExportDeclaration(node) &&
    node.moduleSpecifier !== undefined &&
    isStringLiteral(node.moduleSpecifier)
  ) {
    return { node, specifier: node.moduleSpecifier, kind: "export", typeOnly: node.isTypeOnly }
  }
  if (
    isImportEqualsDeclaration(node) &&
    isExternalModuleReference(node.moduleReference) &&
    isStringLiteral(node.moduleReference.expression)
  ) {
    return {
      node,
      specifier: node.moduleReference.expression,
      kind: "import-equals",
      typeOnly: node.isTypeOnly,
    }
  }
  if (
    isImportTypeNode(node) &&
    isLiteralTypeNode(node.argument) &&
    isStringLiteral(node.argument.literal)
  ) {
    return { node, specifier: node.argument.literal, kind: "import-type", typeOnly: true }
  }
  if (isCallExpression(node)) {
    const [specifier] = node.arguments
    if (specifier === undefined || !isStringLiteral(specifier)) return undefined
    if (isImportExpression(node.expression)) {
      return { node, specifier, kind: "dynamic-import", typeOnly: false }
    }
    if (isIdentifier(node.expression) && node.expression.text === "require") {
      return { node, specifier, kind: "require", typeOnly: false }
    }
  }
  return undefined
}

export const moduleReferences = (scope: Scope): Query<ModuleReference, ProjectSnapshotError> =>
  mapValues(
    nodes(scope, (node): node is Node => moduleReferenceOf(node) !== undefined),
    ({ value }) => moduleReferenceOf(value)!,
  )

export interface ResolvedModuleReference extends ModuleReference {
  readonly resolved: ProjectFile | undefined
}

export const resolvedModuleReferences = (
  scope: Scope,
): Query<ResolvedModuleReference, ProjectSnapshotError> =>
  keepDefined(
    moduleReferences(scope),
    ({ project, value }) =>
      Effect.map(project.resolvedModule(value.specifier), (resolved) => ({ ...value, resolved })),
  )
