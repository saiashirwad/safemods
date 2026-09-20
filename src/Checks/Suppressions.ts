import { Effect } from "effect"
import { SyntaxKind, type Node, type SourceFile } from "typescript/unstable/ast"
import {
  isJsxText,
  isLiteralExpression,
  isNonNullExpression,
  isTemplateLiteralToken,
} from "typescript/unstable/ast/is"
import { createScanner } from "typescript/unstable/ast/scanner"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"
import { filesWithin } from "./Exported.ts"

const directive = /@ts-ignore|@ts-expect-error|@ts-nocheck|(?:eslint|oxlint)-disable/g

const withLiteralsBlanked = (sourceFile: SourceFile): string => {
  const { text } = sourceFile
  const chunks: Array<string> = []
  let end = 0
  const visit = (node: Node): void => {
    if (isLiteralExpression(node) || isTemplateLiteralToken(node) || isJsxText(node)) {
      const start = isJsxText(node) ? node.pos : node.getStart(sourceFile)
      chunks.push(text.slice(end, start), " ".repeat(node.end - start))
      end = node.end
    } else {
      node.forEachChild(visit)
    }
  }
  visit(sourceFile)
  return [...chunks, text.slice(end)].join("")
}

const directivesIn = (sourceFile: SourceFile) => {
  const scanner = createScanner(false, sourceFile.languageVariant, withLiteralsBlanked(sourceFile))
  const matches: Array<{ start: number; text: string }> = []
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (kind === SyntaxKind.SingleLineCommentTrivia || kind === SyntaxKind.MultiLineCommentTrivia) {
      for (const match of scanner.getTokenText().matchAll(directive)) {
        matches.push({ start: scanner.getTokenStart() + match.index, text: match[0] })
      }
    }
  }
  return matches
}

export const suppressions = (options: { readonly within: string }) =>
  Check.perProject("suppressions", (project) =>
    Effect.gen(function* () {
      const files = yield* filesWithin(project, [options.within])
      const asserted = yield* Query.nodes(project, isNonNullExpression).pipe(
        Query.within(options.within),
        Query.collect,
      )
      return [
        ...files.flatMap((file) =>
          directivesIn(file.sourceFile).map((match) => ({
            projectId: project.project.id,
            fileName: file.fileName,
            start: match.start,
            message: `${match.text} silences the compiler: fix the type it complains about`,
          }))
        ),
        ...asserted.map((selection) =>
          Check.report(
            selection,
            `${
              selection.value.getText().replace(/\s+/g, " ").slice(0, 40)
            } asserts non-null on trust: handle the undefined case`,
          )
        ),
      ]
    }))
