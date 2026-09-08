/** Structural AST patterns consumed by Query. */
import { Effect, Option, Predicate } from "effect"
import {
  type CallExpression,
  type FunctionDeclaration,
  type Identifier,
  type Node,
  SyntaxKind,
} from "typescript/unstable/ast"
import { isCallExpression, isFunctionDeclaration, isIdentifier } from "typescript/unstable/ast/is"
import type { EvidenceFact } from "./Evidence.ts"
import type { ProjectSnapshot, ProjectSnapshotError } from "./Workspace/index.ts"
import type { Symbol as NativeSymbol } from "typescript/unstable/async"

export const syntaxKindName = (kind: number): string =>
  // SAFETY: reverse-map coverage of every numeric member makes this total.
  SyntaxKind[kind]!

export interface PatternMatch<Out> {
  readonly value: Out
  readonly facts?: Readonly<Record<string, EvidenceFact>>
}
export type PatternResult<Out> = Option.Option<PatternMatch<Out>>

export type SyntaxKindFilter = SyntaxKind | ReadonlyArray<SyntaxKind>

export interface Pattern<Out = Node> {
  readonly kind?: string
  readonly syntaxKind?: SyntaxKindFilter
  readonly match: (
    node: Node,
    project: ProjectSnapshot,
  ) => Effect.Effect<PatternResult<Out>, ProjectSnapshotError>
}

type Binding<K extends string, Out> = { readonly [P in K]: Out }
type AnyPattern = Pattern<unknown>
type TupleMatch<P extends ReadonlyArray<AnyPattern>> = {
  [K in keyof P]: P[K] extends Pattern<infer Out> ? Out : never
}

const matchSuccess = <Out>(
  value: Out,
  facts?: Readonly<Record<string, EvidenceFact>>,
): PatternResult<Out> => Option.some(facts === undefined ? { value } : { value, facts })

const matchFailure = Option.none()

export const testRegExp = (pattern: RegExp, value: string): boolean => {
  if (!pattern.global && !pattern.sticky) return pattern.test(value)
  const lastIndex = pattern.lastIndex
  try {
    pattern.lastIndex = 0
    return pattern.test(value)
  } finally {
    pattern.lastIndex = lastIndex
  }
}

const matchesName = (name: string | RegExp, text: string): boolean =>
  Predicate.isString(name) ? text === name : testRegExp(name, text)

export const any: Pattern = {
  kind: "any",
  match: (node) => Effect.succeed(matchSuccess(node)),
}

export function predicate<Out extends Node>(
  kind: string,
  test: (node: Node) => node is Out,
  syntaxKind?: SyntaxKindFilter,
): Pattern<Out>
export function predicate(
  kind: string,
  test: (node: Node) => boolean,
  syntaxKind?: SyntaxKindFilter,
): Pattern
export function predicate<Out>(
  kind: string,
  test: (node: Node) => PatternResult<Out>,
  syntaxKind?: SyntaxKindFilter,
): Pattern<Out>
export function predicate<Out>(
  kind: string,
  test: (node: Node) => boolean | PatternResult<Out>,
  syntaxKind?: SyntaxKindFilter,
): Pattern<Out> {
  const result: Pattern<Out> = {
    kind,
    match: (node) =>
      Effect.sync(() => {
        const result = test(node)
        if (result === true) {
          // SAFETY: a `true` result comes from a type guard for Out, or Out is Node.
          return matchSuccess(node as Out)
        }
        return result === false ? matchFailure : result
      }),
  }
  return syntaxKind === undefined ? result : { ...result, syntaxKind }
}

export const bind = <K extends string, Out>(
  key: K,
  pattern: Pattern<Out>,
): Pattern<Binding<K, Out>> => {
  const result = {
    kind: `bind(${key})` as const,
    match: (node: Node, project: ProjectSnapshot) =>
      pattern.match(node, project).pipe(
        Effect.map(
          Option.flatMap((matched) =>
            matchSuccess(
              // SAFETY: the computed key is the binding name supplied to this pattern.
              Object.fromEntries([[key, matched.value]]) as Binding<K, Out>,
              matched.facts,
            ),
          ),
        ),
      ),
  }
  return pattern.syntaxKind === undefined ? result : { ...result, syntaxKind: pattern.syntaxKind }
}

export const tuple = <P extends ReadonlyArray<AnyPattern>>(
  patterns: P,
): Pattern<TupleMatch<P>> => ({
  kind: "tuple",
  match: (node, project) =>
    Effect.gen(function* () {
      const elements: ReadonlyArray<Node> = isCallExpression(node) ? node.arguments : [node]
      if (elements.length !== patterns.length) return matchFailure
      const values: Array<unknown> = []
      const facts = {} satisfies Record<string, EvidenceFact>
      for (let index = 0; index < patterns.length; index++) {
        const result = yield* patterns[index]!.match(elements[index]!, project)
        if (Option.isNone(result)) return matchFailure
        values.push(result.value.value)
        if (result.value.facts !== undefined) Object.assign(facts, result.value.facts)
      }
      // SAFETY: tuple patterns push one value for every matched pattern in order.
      const tupleValues = Object.freeze(values) as TupleMatch<P>
      return matchSuccess(tupleValues, facts)
    }),
})

export const identifier = (options?: {
  readonly name?: string | RegExp
  readonly resolvesTo?: NativeSymbol
}): Pattern<Identifier> => ({
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

interface CallExpressionMatch<EOut, AOut> {
  readonly call: CallExpression
  readonly expression: EOut
  readonly args: AOut
}
const isPattern = <Out>(value: Pattern<Out> | ReadonlyArray<AnyPattern>): value is Pattern<Out> =>
  !Array.isArray(value)
export const callExpression = <EOut = Node, AOut = ReadonlyArray<Node>>(options?: {
  readonly expression?: Pattern<EOut>
  readonly arguments?: Pattern<AOut> | ReadonlyArray<AnyPattern>
}): Pattern<CallExpressionMatch<EOut, AOut>> => {
  const argumentPattern: Pattern<unknown> | undefined =
    options?.arguments === undefined
      ? undefined
      : isPattern(options.arguments)
        ? options.arguments
        : tuple(options.arguments)

  return {
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
          if (Option.isNone(result)) return matchFailure
          expression = result.value.value
          if (result.value.facts !== undefined) Object.assign(facts, result.value.facts)
        }
        // SAFETY: the caller's argument pattern constrains this output type.
        let args = node.arguments as AOut
        if (argumentPattern !== undefined) {
          const result = yield* argumentPattern.match(node, project)
          if (Option.isNone(result)) return matchFailure
          // SAFETY: argumentPattern was constructed from the caller's AOut pattern.
          args = result.value.value as AOut
          if (result.value.facts !== undefined) Object.assign(facts, result.value.facts)
        }
        return matchSuccess({ call: node, expression, args }, facts)
      }),
  }
}

const matchesExportModifier = (node: FunctionDeclaration, expected: boolean | undefined): boolean =>
  expected === undefined ||
  (node.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ?? false) ===
    expected

interface FunctionDeclarationPatternOptions {
  readonly name?: string | RegExp
  readonly async?: boolean
  readonly exported?: boolean
}
export const functionDeclaration = (
  options?: FunctionDeclarationPatternOptions,
): Pattern<FunctionDeclaration> => ({
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
      if (!matchesExportModifier(node, options?.exported)) return matchFailure
      return matchSuccess(
        node,
        node.name === undefined
          ? { kind: syntaxKindName(node.kind) }
          : { kind: syntaxKindName(node.kind), name: node.name.text },
      )
    }),
})
