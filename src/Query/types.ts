import { Effect, Option, Predicate } from "effect"
import type { CallExpression, Node } from "typescript/unstable/ast"
import type { Symbol as NativeSymbol, Type as NativeType } from "typescript/unstable/async"
import * as Pattern from "../Pattern.ts"
import { NodeNotOwned } from "../Workspace/ProjectSnapshot.ts"
import type { IntrinsicTypeName, ProjectSnapshotError } from "../Workspace/index.ts"
import { keepDefined, type Query, type Selection } from "./selection.ts"

export interface TypedNode<A extends Node> {
  readonly node: A
  readonly type: NativeType
}

export const typed = <A extends Node, E, R>(
  self: Query<A, E, R>,
): Query<TypedNode<A>, E | ProjectSnapshotError, R> =>
  keepDefined(
    self,
    ({ project, value }) =>
      Effect.map(project.typeOf(value), (type) =>
        type === undefined ? undefined : { node: value, type }),
  )

type CaptureTypes<C> = {
  readonly [K in keyof C as C[K] extends Node ? K : never]: NativeType | undefined
}

export type WithTypes<M> = M extends { readonly captures: infer C } ?
  M & { readonly types: CaptureTypes<C> } :
  never

export const typedCaptures = <M extends { readonly captures: object }, E, R>(
  self: Query<M, E, R>,
): Query<WithTypes<M>, E | ProjectSnapshotError, R> =>
  keepDefined(self, ({ project, value }) =>
    Effect.map(
      Effect.forEach(
        Object.entries(value.captures).filter(([, captured]) => Pattern.isNode(captured)),
        ([name, captured]) => Effect.map(project.typeOf(captured), (type) => [name, type] as const),
        { concurrency: "unbounded" },
      ),
      (types) => ({ ...value, types: Object.fromEntries(types) }) as WithTypes<M>,
    ))

export const resolvesTo = <A extends Node>(
  symbol: NativeSymbol,
  options?: { readonly location?: (candidate: A) => Node },
) =>
({ project, value }: Selection<A>): Effect.Effect<boolean, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const candidate = yield* project.symbolOf(options?.location?.(value) ?? value)
    if (candidate === undefined) return false
    return (
      (yield* project.canonicalSymbol(candidate)) === (yield* project.canonicalSymbol(symbol))
    )
  })

const sameNode = (left: Node, right: Node): boolean =>
  left.pos === right.pos &&
  left.end === right.end &&
  left.kind === right.kind &&
  left.getSourceFile() === right.getSourceFile()

export const resolvesToSignature =
  (declarations: ReadonlyArray<Selection<Node>>) =>
  ({ project, value }: Selection<CallExpression>): Effect.Effect<boolean, ProjectSnapshotError> =>
    Effect.gen(function* () {
      for (const declaration of declarations) {
        const sourceFile = declaration.value.getSourceFile()
        if (declaration.project !== project || Option.isNone(project.fileNameOf(sourceFile))) {
          return yield* new NodeNotOwned({ fileName: sourceFile.fileName })
        }
      }
      const signature = yield* project.resolvedSignature(value)
      if (signature === undefined) return false
      const resolved = yield* project.signatureDeclaration(signature)
      return (
        resolved !== undefined &&
        declarations.some((declaration) => sameNode(declaration.value, resolved))
      )
    })

export const typeAssignableTo =
  <A extends Node>(target: NativeType | IntrinsicTypeName) =>
  ({ project, value }: Selection<A>): Effect.Effect<boolean, ProjectSnapshotError> =>
    Effect.gen(function* () {
      const type = yield* project.typeOf(value)
      if (type === undefined) return false
      const expected = Predicate.isString(target) ? yield* project.intrinsicType(target) : target
      return yield* project.isTypeAssignableTo(type, expected)
    })
