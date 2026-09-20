import type { Node } from "typescript/unstable/ast"

export interface Pattern<A extends Node, C> {
  readonly _tag: "Pattern"
  readonly guard: (node: Node) => node is A
  readonly match: (node: Node) => C | undefined
}

export interface Capture<Name extends string> {
  readonly _tag: "Capture"
  readonly name: Name
}

type Simplify<A> = { readonly [K in keyof A]: A[K] } & {}

type FieldKeys<A> = {
  [K in keyof A]-?: K extends "parent" ? never : A[K] extends Function ? never : K
}[keyof A]

type FieldPattern<T> =
  | Capture<string>
  | (undefined extends T ? undefined : never)
  | ([NonNullable<T>] extends [ReadonlyArray<infer E>] ? ReadonlyArray<FieldPattern<E>> :
    [NonNullable<T>] extends [Node] ? Pattern<Node, unknown> :
    T | ((value: T) => boolean))

export type Fields<A> = { readonly [K in FieldKeys<A>]?: FieldPattern<A[K]> }

type Captured<T, P> =
    P extends Capture<infer Name> ? { readonly [K in Name]: NonNullable<T> }
  : P extends Pattern<Node, infer C> ? C
  : P extends readonly [infer Head, ...infer Tail] ? 
    & Captured<ElementOf<T>, Head>
    & Captured<T, Tail>
  : {}

type ElementOf<T> = NonNullable<T> extends ReadonlyArray<infer E> ? E : never

export type CapturesOf<A, F> = Simplify<
  {
    [K in keyof F]: (captures: Captured<A[K & keyof A], F[K]>) => void
  }[keyof F] extends (captures: infer C) => void ? C :
    never
>

type Captures = Readonly<Record<string, unknown>>

const isTagged = (value: unknown, tag: string): boolean =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === tag

const isPattern = (value: unknown): value is Pattern<Node, Captures> => isTagged(value, "Pattern")

const isCapture = (value: unknown): value is Capture<string> => isTagged(value, "Capture")

export const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "kind" in value && "forEachChild" in value

const matchAll = (pairs: ReadonlyArray<readonly [unknown, unknown]>): Captures | undefined => {
  let captures: Captures = {}
  for (const [pattern, value] of pairs) {
    const matched = matchField(pattern, value)
    if (matched === undefined) return undefined
    captures = { ...captures, ...matched }
  }
  return captures
}

const matchField = (pattern: unknown, value: unknown): Captures | undefined => {
  if (isCapture(pattern)) return value === undefined ? undefined : { [pattern.name]: value }
  if (isPattern(pattern)) return isNode(value) ? pattern.match(value) : undefined
  if (Array.isArray(pattern)) {
    return Array.isArray(value) && value.length === pattern.length ?
      matchAll(pattern.map((element, index) => [element, value[index]] as const)) :
      undefined
  }
  if (typeof pattern === "function") return pattern(value) === true ? {} : undefined
  return Object.is(pattern, value) ? {} : undefined
}

const make = <A extends Node, C>(
  guard: (node: Node) => node is A,
  match: (node: A) => unknown,
): Pattern<A, C> => ({
  _tag: "Pattern",
  guard,
  match: (candidate) => (guard(candidate) ? (match(candidate) as C | undefined) : undefined),
})

export const capture = <const Name extends string>(name: Name): Capture<Name> => ({
  _tag: "Capture",
  name,
})

export const bind = <const Name extends string, A extends Node, C>(
  name: Name,
  pattern: Pattern<A, C>,
): Pattern<A, Simplify<C & { readonly [K in Name]: A }>> =>
  make(pattern.guard, (candidate) => {
    const captures = pattern.match(candidate)
    return captures === undefined ? undefined : { ...captures, [name]: candidate }
  })

const matchFields = (fields: object): (candidate: Node) => Captures | undefined => {
  const entries = Object.entries(fields)
  return (candidate) =>
    matchAll(entries.map(([key, pattern]) => [pattern, Reflect.get(candidate, key)] as const))
}

export type FieldsError<A, F> =
    [keyof F] extends [FieldKeys<A>] ?
      [F] extends [Fields<A>] ? unknown
    : { readonly wrongFieldType: never }
  : { readonly unknownField: Exclude<keyof F, FieldKeys<A>> }

export const node = <A extends Node, const F extends Fields<A> = {}>(
  guard: (node: Node) => node is A,
  fields?: F & { readonly [K in Exclude<keyof F, FieldKeys<A>>]: never },
): Pattern<A, CapturesOf<A, F>> => make(guard, matchFields(fields ?? {}))

export const unguarded = <A extends Node, F extends object>(
  fields: F,
): Pattern<A, CapturesOf<A, F>> =>
  make((candidate): candidate is A => isNode(candidate), matchFields(fields))

export const either = <A extends Node, CA, B extends Node, CB>(
  left: Pattern<A, CA>,
  right: Pattern<B, CB>,
): Pattern<A | B, CA | CB> =>
  make(
    (candidate): candidate is A | B => left.guard(candidate) || right.guard(candidate),
    (candidate) => left.match(candidate) ?? right.match(candidate),
  )

export interface Matched<Tag extends string, A extends Node, C> {
  readonly _tag: Tag
  readonly node: A
  readonly captures: C
}

export type MatchedOf<Patterns> = {
  [Tag in keyof Patterns & string]: Patterns[Tag] extends Pattern<infer A, infer C> ?
    Matched<Tag, A, C> :
    never
}[keyof Patterns & string]

export type Tagged = Readonly<Record<string, Pattern<Node, unknown>>>

export const tagged = <const Patterns extends Tagged>(
  patterns: Patterns,
): (candidate: Node) => MatchedOf<Patterns> | undefined => {
  const entries = Object.entries(patterns)
  return (candidate) => {
    for (const [tag, pattern] of entries) {
      const captures = pattern.match(candidate)
      if (captures !== undefined) {
        return { _tag: tag, node: candidate, captures } as MatchedOf<Patterns>
      }
    }
    return undefined
  }
}
