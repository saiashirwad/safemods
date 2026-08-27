import { SyntaxKind } from "typescript/unstable/ast"

/**
 * Render a node kind as its source-facing name via the SyntaxKind reverse map.
 * Every numeric ts.SyntaxKind member owns a reverse entry, so the lookup is
 * total and never falls back.
 */
export const syntaxKindName = (kind: number): string =>
  // SAFETY: reverse-map coverage of every numeric member makes this total.
  SyntaxKind[kind]!
