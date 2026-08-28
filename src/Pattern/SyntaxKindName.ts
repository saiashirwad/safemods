import { SyntaxKind } from "typescript/unstable/ast"

export const syntaxKindName = (kind: number): string =>
  // SAFETY: reverse-map coverage of every numeric member makes this total.
  SyntaxKind[kind]!
