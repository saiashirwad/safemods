/**
 * Module specifier rewriting for file moves.
 */
import { posix as PathPosix } from "node:path"
import { SyntaxKind, type Node, type SourceFile, type StringLiteral } from "typescript/unstable/ast"
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

const moduleExtension = /\.(ts|tsx|js|jsx)$/

export const stripModuleExtension = (value: string): string => value.replace(moduleExtension, "")

const specifierExtension = (specText: string): string => {
  const match = moduleExtension.exec(specText)
  return match?.[0] ?? ""
}

const isRelativeSpecifier = (specText: string): boolean =>
  specText.startsWith("./") || specText.startsWith("../")

const relativePath = (fromDir: string, toPath: string): string => {
  const rel = PathPosix.relative(fromDir, toPath)
  return rel === "" ? "." : rel
}

const resolvedSpecifierPath = (fileDir: string, specText: string): string =>
  PathPosix.normalize(PathPosix.join(fileDir, specText))

/**
 * Resolve a relative module specifier to a normalized project-relative path
 * (extension kept), or `undefined` for bare package specifiers.
 */
export const resolveRelativeSpecifier = (
  importerPath: string,
  specText: string,
): string | undefined => {
  if (!isRelativeSpecifier(specText)) return undefined
  return resolvedSpecifierPath(PathPosix.dirname(importerPath), specText)
}

const refersToMovedModule = (resolved: string, fromBase: string, sourcePath: string): boolean => {
  const stripped = stripModuleExtension(resolved)
  return stripped === fromBase || stripped === sourcePath
}

const quotedSpecifier = (file: SourceFile, specifier: StringLiteral, next: string): string => {
  const start = specifier.getStart(file)
  const quote = file.text[start] === "'" ? "'" : '"'
  return `${quote}${next}${quote}`
}

const rewriteRelativeSpecifier = (
  specText: string,
  fromDir: string,
  toDir: string,
): string | undefined => {
  if (!isRelativeSpecifier(specText) || fromDir === toDir) return undefined
  const next = relativePath(toDir, resolvedSpecifierPath(fromDir, specText))
  const withDot = next.startsWith(".") ? next : `./${next}`
  return withDot === specText ? undefined : withDot
}

const rewriteMovedTargetSpecifier = (
  specText: string,
  fileDir: string,
  toBase: string,
): string | undefined => {
  if (!isRelativeSpecifier(specText)) return undefined
  const next = `${relativePath(fileDir, toBase)}${specifierExtension(specText)}`
  const withDot = next.startsWith(".") ? next : `./${next}`
  return withDot === specText ? undefined : withDot
}

interface SpecifierReplacement {
  readonly start: number
  readonly end: number
  readonly newText: string
}

/** The string literal a node uses as a module specifier, if it has one. */
const specifierLiteral = (node: Node): StringLiteral | undefined => {
  if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier
  }
  if (
    isExportDeclaration(node) &&
    node.moduleSpecifier !== undefined &&
    isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier
  }
  if (
    isImportEqualsDeclaration(node) &&
    isExternalModuleReference(node.moduleReference) &&
    isStringLiteral(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression
  }
  if (
    isCallExpression(node) &&
    node.arguments[0] !== undefined &&
    isStringLiteral(node.arguments[0])
  ) {
    const expression = node.expression
    const isImportCall =
      expression.kind === SyntaxKind.ImportKeyword || isImportExpression(expression)
    const isRequireCall = isIdentifier(expression) && expression.text === "require"
    if (isImportCall || isRequireCall) return node.arguments[0]
  }
  if (
    isImportTypeNode(node) &&
    isLiteralTypeNode(node.argument) &&
    isStringLiteral(node.argument.literal)
  ) {
    return node.argument.literal
  }
  return undefined
}

const eachModuleSpecifier = (file: SourceFile, visit: (specifier: StringLiteral) => void): void => {
  const walk = (node: Node): void => {
    const specifier = specifierLiteral(node)
    if (specifier !== undefined) visit(specifier)
    node.forEachChild((child) => {
      walk(child)
      return undefined
    })
  }
  walk(file)
}

/**
 * Compute the specifier replacements a move requires in one file. The moved
 * file's own relative imports are rewritten for its new directory; other
 * files' specifiers are rewritten when they resolve to the moved module.
 * Specifiers whose rewritten form equals their current text are skipped.
 */
export const specifierReplacements = (
  file: SourceFile,
  relFile: string,
  sourcePath: string,
  targetPath: string,
  fromBase: string,
  toBase: string,
): Array<SpecifierReplacement> => {
  const fileDir = PathPosix.dirname(relFile)
  const sourceDir = PathPosix.dirname(sourcePath)
  const targetDir = PathPosix.dirname(targetPath)
  const replacements: Array<SpecifierReplacement> = []
  eachModuleSpecifier(file, (specifier) => {
    const specText = specifier.text
    const next =
      relFile === sourcePath
        ? rewriteRelativeSpecifier(specText, sourceDir, targetDir)
        : refersToMovedModule(resolvedSpecifierPath(fileDir, specText), fromBase, sourcePath)
          ? rewriteMovedTargetSpecifier(specText, fileDir, toBase)
          : undefined
    if (next === undefined) return
    replacements.push({
      start: specifier.getStart(file),
      end: specifier.getEnd(),
      newText: quotedSpecifier(file, specifier, next),
    })
  })
  return replacements
}
