import { Effect } from "effect"
import {
  SyntaxKind,
  type ClassDeclaration,
  type FunctionDeclaration,
  type VariableStatement,
} from "typescript/unstable/ast"
import {
  isClassDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isVariableStatement,
} from "typescript/unstable/ast/is"
import { matchFailure, matchSuccess, matchesName, type Pattern } from "./Pattern.ts"
import { syntaxKindName } from "./SyntaxKindName.ts"

export interface FunctionDeclarationPatternOptions {
  readonly name?: string | RegExp
  readonly async?: boolean
  readonly exported?: boolean
}
export const functionDeclaration = (
  options?: FunctionDeclarationPatternOptions,
): Pattern<FunctionDeclaration, FunctionDeclaration> => ({
  mode: "node",
  kind: "functionDeclaration",
  syntaxKind: SyntaxKind.FunctionDeclaration,
  match: (node) =>
    Effect.sync(() => {
      if (!isFunctionDeclaration(node)) return matchFailure
      if (
        options?.name !== undefined &&
        (node.name === undefined || !matchesName(options.name, node.name.text))
      )
        return matchFailure
      if (
        options?.async !== undefined &&
        (node.modifiers?.some((m) => m.kind === SyntaxKind.AsyncKeyword) ?? false) !== options.async
      )
        return matchFailure
      if (
        options?.exported !== undefined &&
        (node.modifiers?.some((m) => m.kind === SyntaxKind.ExportKeyword) ?? false) !==
          options.exported
      )
        return matchFailure
      return matchSuccess(
        node,
        node.name === undefined
          ? { kind: syntaxKindName(node.kind) }
          : { kind: syntaxKindName(node.kind), name: node.name.text },
      )
    }),
})

export interface ClassDeclarationPatternOptions {
  readonly name?: string | RegExp
  readonly exported?: boolean
}
export const classDeclaration = (
  options?: ClassDeclarationPatternOptions,
): Pattern<ClassDeclaration, ClassDeclaration> => ({
  mode: "node",
  kind: "classDeclaration",
  syntaxKind: SyntaxKind.ClassDeclaration,
  match: (node) =>
    Effect.sync(() => {
      if (!isClassDeclaration(node)) return matchFailure
      if (
        options?.name !== undefined &&
        (node.name === undefined || !matchesName(options.name, node.name.text))
      )
        return matchFailure
      if (
        options?.exported !== undefined &&
        (node.modifiers?.some((m) => m.kind === SyntaxKind.ExportKeyword) ?? false) !==
          options.exported
      )
        return matchFailure
      return matchSuccess(
        node,
        node.name === undefined
          ? { kind: syntaxKindName(node.kind) }
          : { kind: syntaxKindName(node.kind), name: node.name.text },
      )
    }),
})

export interface VariableStatementPatternOptions {
  readonly name?: string | RegExp
  readonly exported?: boolean
}
export const variableStatement = (
  options?: VariableStatementPatternOptions,
): Pattern<VariableStatement, VariableStatement> => ({
  mode: "node",
  kind: "variableStatement",
  syntaxKind: SyntaxKind.VariableStatement,
  match: (node) =>
    Effect.sync(() => {
      if (!isVariableStatement(node)) return matchFailure
      if (
        options?.exported !== undefined &&
        (node.modifiers?.some((m) => m.kind === SyntaxKind.ExportKeyword) ?? false) !==
          options.exported
      )
        return matchFailure
      if (
        options?.name !== undefined &&
        !node.declarationList.declarations.some(
          (d) => isIdentifier(d.name) && matchesName(options.name!, d.name.text),
        )
      )
        return matchFailure
      return matchSuccess(node, { kind: syntaxKindName(node.kind) })
    }),
})
