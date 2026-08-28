import { Effect } from "effect"
import {
  SyntaxKind,
  type CallExpression,
  type Identifier,
  type Node,
  type ObjectLiteralExpression,
} from "typescript/unstable/ast"
import {
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
} from "typescript/unstable/ast/is"
import type { Symbol as NativeSymbol } from "typescript/unstable/async"
import type { EvidenceFact } from "../Evidence/Evidence.ts"
import {
  matchFailure,
  matchSuccess,
  matchesName,
  tuple,
  type AnyPattern,
  type Pattern,
} from "./Pattern.ts"
import { syntaxKindName } from "./SyntaxKindName.ts"

export const identifier = (options?: {
  readonly name?: string | RegExp
  readonly resolvesTo?: NativeSymbol
}): Pattern<Identifier, Identifier> => ({
  mode: "node",
  kind: "identifier",
  syntaxKind: SyntaxKind.Identifier,
  match: (node, project) =>
    Effect.gen(function* () {
      if (
        !isIdentifier(node) ||
        (options?.name !== undefined && !matchesName(options.name, node.text))
      )
        return matchFailure
      if (options?.resolvesTo !== undefined) {
        const symbol = yield* project.symbolAt(
          node.getSourceFile().fileName,
          node.getStart(node.getSourceFile()),
        )
        if (symbol === undefined) return matchFailure
        const canonical = yield* project.canonicalSymbol(symbol)
        if (canonical !== options.resolvesTo) return matchFailure
      }
      return matchSuccess(node, { identifier: node.text })
    }),
})

export interface CallExpressionMatch<EOut, AOut> {
  readonly call: CallExpression
  readonly expression: EOut
  readonly args: AOut
}
const isPattern = <Out>(
  value: Pattern<Node, Out> | ReadonlyArray<AnyPattern>,
): value is Pattern<Node, Out> => !Array.isArray(value)
export const callExpression = <EOut = Node, AOut = ReadonlyArray<Node>>(options?: {
  readonly expression?: Pattern<Node, EOut>
  readonly arguments?: Pattern<Node, AOut> | ReadonlyArray<AnyPattern>
}): Pattern<CallExpression, CallExpressionMatch<EOut, AOut>> => {
  const argumentPattern =
    options?.arguments === undefined
      ? undefined
      : isPattern(options.arguments)
        ? options.arguments
        : tuple(options.arguments)

  return {
    mode: "node",
    kind: "callExpression",
    syntaxKind: SyntaxKind.CallExpression,
    match: (node, project) =>
      Effect.gen(function* () {
        if (!isCallExpression(node)) return matchFailure
        const facts = { kind: syntaxKindName(node.kind) } satisfies Record<string, EvidenceFact>
        // SAFETY: the caller's expression pattern constrains this output type.
        let expression = node.expression as EOut
        if (options?.expression !== undefined) {
          const result = yield* options.expression.match(node.expression, project)
          if (!result.matched) return matchFailure
          expression = result.value
          if (result.facts !== undefined) Object.assign(facts, result.facts)
        }
        // SAFETY: the caller's argument pattern constrains this output type.
        let args = node.arguments as AOut
        if (argumentPattern !== undefined) {
          const result = yield* argumentPattern.match(node, project)
          if (!result.matched) return matchFailure
          // SAFETY: argumentPattern was constructed from the caller's AOut pattern.
          args = result.value as AOut
          if (result.facts !== undefined) Object.assign(facts, result.facts)
        }
        return matchSuccess({ call: node, expression, args }, facts)
      }),
  }
}

export const objectLiteral = (options?: {
  readonly hasProperties?: ReadonlyArray<string>
}): Pattern<ObjectLiteralExpression, ObjectLiteralExpression> => ({
  mode: "node",
  kind: "objectLiteral",
  syntaxKind: SyntaxKind.ObjectLiteralExpression,
  match: (node) =>
    Effect.sync(() => {
      if (!isObjectLiteralExpression(node)) return matchFailure
      if (options?.hasProperties !== undefined) {
        const names = new Set(
          node.properties
            .filter(isPropertyAssignment)
            .map((p) => (isIdentifier(p.name) || isStringLiteral(p.name) ? p.name.text : "")),
        )
        if (!options.hasProperties.every((name) => names.has(name))) {
          return matchFailure
        }
      }
      return matchSuccess(node, { propertyCount: node.properties.length })
    }),
})
