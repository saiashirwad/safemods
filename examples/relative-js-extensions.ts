/**
 * Rewrite relative import/export specifiers to NodeNext .js form.
 * Package specifiers and already-correct .js paths are left unchanged.
 */
import { Effect } from "effect"
import { SyntaxKind, type StringLiteral } from "typescript/unstable/ast"
import {
  isCallExpression,
  isExportDeclaration,
  isImportDeclaration,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const toNodeNextSpecifier = (specifier: string): string | undefined => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return undefined
  }
  if (specifier.endsWith(".d.ts")) {
    return undefined
  }
  if (specifier.endsWith(".ts")) {
    return `${specifier.slice(0, -3)}.js`
  }
  if (
    specifier.endsWith(".js") ||
    specifier.endsWith(".mjs") ||
    specifier.endsWith(".cjs") ||
    specifier.endsWith(".json")
  ) {
    return undefined
  }
  const basename = specifier.slice(specifier.lastIndexOf("/") + 1)
  if (basename.includes(".")) {
    return undefined
  }
  return `${specifier}.js`
}

const isRewritableModuleSpecifier = (literal: StringLiteral): boolean => {
  if (toNodeNextSpecifier(literal.text) === undefined) {
    return false
  }
  const parent = literal.parent
  if (isImportDeclaration(parent) || isExportDeclaration(parent)) {
    return parent.moduleSpecifier === literal
  }
  return (
    isCallExpression(parent) &&
    parent.expression.kind === SyntaxKind.ImportKeyword &&
    parent.arguments[0] === literal
  )
}

export const relativeJsExtensions = Recipe.define("relative-js-extensions", {
  version: "1.0.0",
  policies: { matchCount: { min: 1 }, idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const drafts = yield* Effect.forEach(snapshot.projects, (configured) =>
        Effect.gen(function* () {
          const project = yield* snapshot.project(configured)
          const specifiers = yield* Query.nodes(
            project,
            isStringLiteral,
            SyntaxKind.StringLiteral,
          ).pipe(
            Query.filter((selection) => isRewritableModuleSpecifier(selection.value)),
            Query.collect,
          )
          return yield* Draft.replaceEach(specifiers, (selection) => {
            const next = toNodeNextSpecifier(selection.value.text)
            if (next === undefined) {
              return Draft.empty
            }
            const quote = selection.value.getText().startsWith("'") ? "'" : '"'
            return { node: selection.value, text: `${quote}${next}${quote}` }
          })
        }),
      )
      return yield* Draft.concat(...drafts)
    }),
})
